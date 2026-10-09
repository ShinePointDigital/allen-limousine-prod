import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFileSync} from "node:fs";
import test, {after,type TestContext} from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import {DriverTripService,DriverTripError} from "./driver-trip-service.js";
import {createDriverTripRouter,createDispatcherCaptureRouter} from "./driver-trip-routes.js";
import {captureBookingPayment} from "./payment-capture.js";
import {prisma,getInquiryByBookingRequestId,updateInquiryPaymentStatusByIntent,authenticate,createAdmin,updateRide} from "./store.js";
import {staffGuard} from "./account-routes.js";
import {DispatchWizardService} from "./dispatch-wizard-service.js";

assert.ok(process.env.NODE_TEST_CONTEXT,"Only guarded development fixtures may be changed.");
after(()=>prisma.$disconnect());
test("published driver HTML suppresses capability referrers, caching and indexing",()=>{
  const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  const headers=config.headers.find((rule:{source:string})=>rule.source==="/driver/trip/(.*)").headers;
  assert.ok(headers.some((header:{key:string;value:string})=>header.key==="Referrer-Policy"&&header.value==="no-referrer"));
  assert.ok(headers.some((header:{key:string;value:string})=>header.key==="Cache-Control"&&header.value==="no-store"));
  assert.ok(headers.some((header:{key:string;value:string})=>header.key==="X-Robots-Tag"&&header.value==="noindex, nofollow"));
});
async function fixture(t:TestContext) {
  const tag=crypto.randomUUID();
  const vehicle=await prisma.fleetVehicle.create({data:{name:"Driver test vehicle",category:"SUV",description:"Fixture",imageUrl:"/fixture.jpg",passengers:"6",luggage:"4"}});
  const driver=await prisma.chauffeur.create({data:{name:"Driver fixture",phone:"+13125550123",fleetVehicleId:vehicle.id}});
  const booking=await prisma.inquiry.create({data:{
    fullName:"Driver Trip Customer",email:`${tag}@example.invalid`,phone:"+13125550128",pickup:"Test pickup",destination:"Test destination",
    serviceType:"Point-to-Point",pickupAt:new Date(Date.now()+3600000),passengers:1,estimatedFareCents:8500,
    gratuityCents:1275,authorizedTotalCents:9775,bookingRequestId:tag,stripePaymentIntentId:`pi_${tag.replaceAll("-","")}`,paymentStatus:"requires_capture",
  }});
  const ride=await prisma.ride.create({data:{inquiryId:booking.id,driverId:driver.id,driverName:driver.name,driverPhone:driver.phone,vehicleId:vehicle.id,status:"ASSIGNED",quoteCents:8500}});
  t.after(async()=>{
    await prisma.inquiry.deleteMany({where:{id:booking.id}});
    await prisma.chauffeur.deleteMany({where:{id:driver.id}});
    await prisma.fleetVehicle.deleteMany({where:{id:vehicle.id}});
  });
  const intent={id:booking.stripePaymentIntentId!,amount:9775,currency:"usd",status:"requires_capture",amount_received:0};
  let charges=0;let responseLost=false;let decline=false;
  const keys=new Set<string>();
  const capture=async(id:string)=>captureBookingPayment(id,{
    findBooking:getInquiryByBookingRequestId,sync:updateInquiryPaymentStatusByIntent,
    stripe:async()=>({paymentIntents:{
      retrieve:async()=>({...intent}),
      capture:async(_id,_data,options)=>{
        if(decline)throw new Error("Simulated capture rejection");
        if(!keys.has(options.idempotencyKey)){keys.add(options.idempotencyKey);charges++;}
        intent.status="succeeded";intent.amount_received=intent.amount;
        if(responseLost){responseLost=false;throw new Error("Simulated lost provider response");}
        return {...intent};
      },
    }}),
  });
  const service=new DriverTripService(capture,prisma,()=> "synthetic-driver-test-signing-key");
  const access=await service.issue(ride.id);
  const url=service.link(access,"https://driver-test.example.invalid");
  const token=new URL(url).pathname.split("/").at(-1)!;
  return {booking,ride,driver,vehicle,service,capture,token,url,intent,charges:()=>charges,
    loseResponse:()=>{responseLost=true;},rejectCapture:(value:boolean)=>{decline=value;}};
}
test("driver capabilities are scoped, expiring, stored hashed and stable for SMS retries",async t=>{
  const f=await fixture(t);
  assert.match(f.token,/^[a-f0-9]{64}$/);
  assert.notEqual((await prisma.ride.findUniqueOrThrow({where:{id:f.ride.id}})).driverAccessTokenHash,f.token);
  assert.equal(f.service.link(await f.service.issue(f.ride.id),"https://driver-test.example.invalid"),f.url);
  const trip=await f.service.get(f.token);
  assert.equal(trip.authorizedTotalCents,9775);
  assert.equal("stripePaymentIntentId" in trip,false);assert.equal("email" in trip,false);
  await assert.rejects(f.service.get(f.booking.bookingRequestId!),DriverTripError);
  await assert.rejects(f.service.get("a".repeat(64)),DriverTripError);
  await prisma.ride.update({where:{id:f.ride.id},data:{driverAccessExpiresAt:new Date(Date.now()-1000)}});
  await assert.rejects(f.service.get(f.token),DriverTripError);
});
test("status transitions are sequential, audited, idempotent and complete captures approved gratuity",async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.transition(f.token,"COMPLETED"),/cannot be skipped/);
  await f.service.transition(f.token,"EN_ROUTE");
  await f.service.transition(f.token,"EN_ROUTE");
  await f.service.transition(f.token,"IN_PROGRESS");
  await assert.rejects(f.service.transition(f.token,"EN_ROUTE"),/cannot be skipped/);
  const trip=await f.service.transition(f.token,"COMPLETED");
  assert.equal(trip.status,"COMPLETED");assert.equal(trip.paymentStatus,"succeeded");
  assert.equal(f.intent.amount_received,9775);assert.equal(f.charges(),1);
  await f.service.transition(f.token,"COMPLETED");
  await f.capture(f.booking.bookingRequestId!);
  assert.equal(f.charges(),1);
  assert.equal(await prisma.inquiryNote.count({where:{inquiryId:f.booking.id}}),3);
});
test("failed or uncertain captures do not complete a ride; dispatcher retry reconciles without a second charge",async t=>{
  const f=await fixture(t);
  await f.service.transition(f.token,"EN_ROUTE");await f.service.transition(f.token,"IN_PROGRESS");
  f.rejectCapture(true);
  await assert.rejects(f.service.transition(f.token,"COMPLETED"),/not marked complete/);
  assert.equal((await f.service.get(f.token)).status,"IN_PROGRESS");assert.equal(f.charges(),0);
  f.rejectCapture(false);f.loseResponse();
  await assert.rejects(f.service.transition(f.token,"COMPLETED"),/not marked complete/);
  assert.equal(f.charges(),1);assert.equal((await f.service.get(f.token)).status,"IN_PROGRESS");
  await f.capture(f.booking.bookingRequestId!);
  await f.service.transition(f.token,"COMPLETED");
  assert.equal(f.charges(),1);
});
test("simultaneous driver completion and dispatcher capture share a single idempotency key",async t=>{
  const f=await fixture(t);
  await f.service.transition(f.token,"EN_ROUTE");await f.service.transition(f.token,"IN_PROGRESS");
  await Promise.all([f.service.transition(f.token,"COMPLETED"),f.capture(f.booking.bookingRequestId!)]);
  assert.equal(f.charges(),1);assert.equal((await f.service.get(f.token)).status,"COMPLETED");
});
test("legacy trips without a card authorization expose honest payment state and never invent a charge",async t=>{
  const f=await fixture(t);
  await prisma.inquiry.update({where:{id:f.booking.id},data:{paymentStatus:null,stripePaymentIntentId:null,estimatedFareCents:null,authorizedTotalCents:null,gratuityCents:0}});
  let trip=await f.service.get(f.token);
  assert.equal(trip.hasCardAuthorization,false);assert.equal(trip.paymentStatus,null);assert.equal(trip.authorizedTotalCents,null);
  await f.service.transition(f.token,"EN_ROUTE");await f.service.transition(f.token,"IN_PROGRESS");
  trip=await f.service.transition(f.token,"COMPLETED");
  assert.equal(trip.status,"COMPLETED");assert.equal(trip.paymentStatus,null);assert.equal(f.charges(),0);
});
test("reassignment and deactivation revoke old links, including reassigning back to the previous driver",async t=>{
  const f=await fixture(t);
  await updateRide(f.ride.id,{driverName:"Replacement Driver",driverPhone:"+13125550199"});
  await assert.rejects(f.service.get(f.token),DriverTripError);
  await updateRide(f.ride.id,{driverName:f.driver.name,driverPhone:f.driver.phone});
  await assert.rejects(f.service.get(f.token),DriverTripError);
  const next=f.service.link(await f.service.issue(f.ride.id),"https://driver-test.example.invalid");
  const token=new URL(next).pathname.split("/").at(-1)!;
  assert.notEqual(token,f.token);
  await prisma.chauffeur.update({where:{id:f.driver.id},data:{active:false}});
  await assert.rejects(f.service.get(token),DriverTripError);
});
test("capture validates original totals, legacy fares, cancelled holds and pending provider responses",async t=>{
  const f=await fixture(t);
  f.intent.amount=8500;
  await assert.rejects(f.capture(f.booking.bookingRequestId!),/does not match/);assert.equal(f.charges(),0);
  await prisma.inquiry.update({where:{id:f.booking.id},data:{gratuityCents:0,authorizedTotalCents:null}});
  await f.capture(f.booking.bookingRequestId!);assert.equal(f.intent.amount_received,8500);
  f.intent.status="canceled";
  await assert.rejects(f.capture(f.booking.bookingRequestId!),/cannot be captured/);
  await assert.rejects(captureBookingPayment("fixture",{
    findBooking:async()=>({estimatedFareCents:100,stripePaymentIntentId:"pi_fixture"}),
    stripe:async()=>({paymentIntents:{retrieve:async()=>({id:"pi_fixture",amount:100,currency:"usd",status:"requires_capture"}),capture:async()=>({id:"pi_fixture",amount:100,currency:"usd",status:"processing"})}}),
    sync:async()=>{},
  }),/not yet confirmed/);
});
test("driver and dispatcher HTTP routes enforce token, status and staff permission boundaries",async t=>{
  const f=await fixture(t);
  const users:string[]=[];t.after(async()=>{await prisma.adminUser.deleteMany({where:{id:{in:users}}});});
  const app=express();app.use(express.json(),cookieParser());
  app.use(createDriverTripRouter(f.service),createDispatcherCaptureRouter(staffGuard,f.capture));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const base=`http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/api/driver/trips/${f.token}`)).status,200);
  assert.equal((await fetch(`${base}/api/driver/trips/${"b".repeat(64)}`)).status,404);
  assert.equal((await fetch(`${base}/api/driver/trips/${f.token}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"COMPLETED"})})).status,409);
  assert.equal((await fetch(`${base}/api/driver/trips/${f.token}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"CANCELLED"})})).status,400);
  const captureUrl=`${base}/api/admin/rides/${f.ride.id}/capture`;
  assert.equal((await fetch(captureUrl,{method:"POST"})).status,401);
  for(const [permissions,expected] of [[["rides"],200],[["payments"],200],[["content"],403]] as const){
    const password=crypto.randomUUID();
    const user=await createAdmin({name:"Capture Permission Fixture",email:`${crypto.randomUUID()}@example.invalid`,password,role:"ADMIN",permissions:[...permissions]});
    users.push(user.id);
    const login=await authenticate(user.email,password);assert.ok(login);
    const response=await fetch(captureUrl,{method:"POST",headers:{Cookie:`allan_session=${login.token}`}});
    assert.equal(response.status,expected);
  }
  assert.equal(f.charges(),1);
});
test("new dispatch SMS includes the driver controls link and retains it across retries and service restart",async t=>{
  const f=await fixture(t);
  const actor=await prisma.adminUser.create({data:{name:"SMS Fixture",email:`${crypto.randomUUID()}@example.invalid`,passwordHash:"test-not-login",role:"ADMIN",permissions:["rides"]}});
  t.after(()=>prisma.adminUser.delete({where:{id:actor.id}}));
  await prisma.ride.update({where:{id:f.ride.id},data:{status:"UNASSIGNED",driverId:null,driverName:null,driverPhone:null,vehicleId:null}});
  const sent:string[]=[];
  const sender=async(_phone:string,body:string)=>{sent.push(body);return {providerMessageId:`SM${crypto.randomUUID().replaceAll("-","")}`,providerStatus:"queued"};};
  const factory=()=>new DispatchWizardService(sender,prisma,async()=>false,ride=>f.service.link(ride,"https://driver-test.example.invalid"));
  let wizard=factory();let snapshot=await wizard.snapshot(f.booking.id);
  snapshot=await wizard.review(f.booking.id,snapshot.version,actor);
  snapshot=await wizard.assign(f.booking.id,snapshot.version,f.driver.id,actor,f.vehicle.id);
  await f.service.ensureForBooking(f.booking.id);
  snapshot=await wizard.snapshot(f.booking.id);
  await wizard.dispatch(f.booking.id,snapshot.version,actor);
  assert.equal(sent.length,1);assert.match(sent[0],/Trip controls & navigation: https:\/\/driver-test.example.invalid\/driver\/trip\/[a-f0-9]{64}/);
  wizard=factory();snapshot=await wizard.snapshot(f.booking.id);
  await wizard.dispatch(f.booking.id,snapshot.version,actor);
  assert.equal(sent.length,1,"Already accepted dispatch SMS is not resent");
});
