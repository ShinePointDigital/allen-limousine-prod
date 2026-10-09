import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { addInquiry, authenticate, createAdmin, finalizeAuthorizedInquiry, getInquiryByBookingRequestId, getRideByInquiryId, prisma } from "./store.js";
import { bookingAmounts, type GratuitySelection } from "../shared/gratuity.js";

test("gratuity persists separately, retries preserve it, and activation preserves the fare", async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "Database tests must use the guarded development connection.");
  const email = `gratuity-${crypto.randomUUID()}@example.invalid`;
  const base = {
    fullName: "Gratuity Fixture", email, phone: "+13125550123", serviceType: "Point-to-Point",
    pickupAt: new Date(Date.now() + 3600000).toISOString(), pickup: "Test pickup", destination: "Test destination",
    passengers: 1, paymentStatus: "authorization_pending", grossFareCents: 12345,
  };
  try {
    for (const selection of [{kind:"none"}, {kind:"percentage",percent:15}, {kind:"custom",amountCents:1001}] as GratuitySelection[]) {
      const totals = bookingAmounts(12345,0,selection);
      const input = {...base,bookingRequestId:crypto.randomUUID(),gratuitySelection:selection,expectedAuthorizedTotalCents:totals.authorizedTotalCents};
      const first = await addInquiry(input);
      assert.equal(first.created,true);
      assert.equal(first.inquiry.status,"PAYMENT_PENDING");
      assert.equal(await getRideByInquiryId(first.inquiry.id),null);
      const retry = await addInquiry(input);
      assert.equal(retry.created,false);
      assert.equal(retry.inquiry.id,first.inquiry.id);
      assert.deepEqual(retry.inquiry.gratuitySelection,selection);
      assert.equal(retry.inquiry.gratuityCents,totals.gratuityCents);
      assert.equal(retry.inquiry.authorizedTotalCents,totals.authorizedTotalCents);
      // This store operation is called only by the authorization activation owner.
      await finalizeAuthorizedInquiry(input.bookingRequestId,crypto.randomBytes(32).toString("hex"),new Date(Date.now()+86400000).toISOString());
      const ride = await getRideByInquiryId(first.inquiry.id);
      assert.equal(ride?.quoteCents,12345,"Trip fare must not include gratuity");
      assert.equal(ride?.inquiry.gratuityCents,totals.gratuityCents);
      assert.equal(ride?.inquiry.authorizedTotalCents,totals.authorizedTotalCents);
    }
    const discounted = await addInquiry({...base,phone:"+13125550987",email:`discount-${email}`,bookingRequestId:crypto.randomUUID(),promoCode:"WELCOME15",gratuitySelection:{kind:"percentage",percent:20},expectedAuthorizedTotalCents:13014});
    assert.equal(discounted.inquiry.estimatedFareCents,10845);
    assert.equal(discounted.inquiry.gratuityCents,2169);
    assert.equal(discounted.inquiry.authorizedTotalCents,13014);
    const rejectedId=crypto.randomUUID();
    await assert.rejects(addInquiry({...base,bookingRequestId:rejectedId,gratuitySelection:{kind:"custom",amountCents:500},expectedAuthorizedTotalCents:12345}),/Review/);
    assert.equal(await getInquiryByBookingRequestId(rejectedId),null,"Rejected amount must not leave a booking");
  } finally {
    await prisma.inquiry.deleteMany({where:{email:{in:[email,`discount-${email}`]}}});
    await prisma.$disconnect();
  }
});

test("public booking endpoint rejects changed gratuity retries and unapproved tips before charging", async () => {
  process.env.VERCEL="1";
  const originalFetch=globalThis.fetch;
  // All external requests are intercepted; no real Maps, Stripe, or SMS traffic.
  globalThis.fetch=async(input,options)=>{
    const url=String(input);
    if(url.startsWith("https://maps.googleapis.com/maps/api/geocode/json")) return Response.json({status:"OK",results:[{formatted_address:"Test Chicago address",geometry:{location:{lat:41.88,lng:-87.63}}}]});
    if(url.startsWith("https://maps.googleapis.com/maps/api/distancematrix/json")) return Response.json({status:"OK",rows:[{elements:[{status:"OK",distance:{value:16093},duration:{value:1800}}]}]});
    if(!url.startsWith("http://127.0.0.1:")) throw new Error("Unexpected external network request blocked");
    return originalFetch(input,options);
  };
  const {app}=await import("./index.js");
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address();
  assert.ok(address && typeof address!=="string");
  const origin=`http://127.0.0.1:${address.port}`;
  const email=`gratuity-api-${crypto.randomUUID()}@example.invalid`;
  const accountIds: string[]=[];
  const input={
    fullName:"API Gratuity Fixture",email,phone:"+13125550129",serviceType:"Point-to-Point",
    pickup:"Test pickup for gratuity",destination:"Test destination for gratuity",pickupAt:new Date(Date.now()+3600000).toISOString(),passengers:1,
    rateTier:"EXECUTIVE_SEDAN",bookingRequestId:crypto.randomUUID(),gratuitySelection:{kind:"custom",amountCents:1250},
  };
  async function post(body:unknown) {
    const response=await fetch(origin+"/api/inquiries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  try {
    const preview=await fetch(origin+"/api/fare/calculate?"+new URLSearchParams({pickup:input.pickup,destination:input.destination,tier:input.rateTier}));
    const fare=await preview.json();
    assert.equal(preview.status,200);
    const payload={...input,estimatedFareCents:1,expectedAuthorizedTotalCents:fare.fareCents+1250};
    assert.equal((await post(input)).status,400,"Tip requires explicit approval of total");
    const first=await post(payload);
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(first.data.inquiry.estimatedFareCents,fare.fareCents,"Tampered client fare is not trusted");
    assert.equal(first.data.inquiry.gratuityCents,1250);
    assert.equal(first.data.inquiry.authorizedTotalCents,fare.fareCents+1250);
    const retry=await post(payload);
    assert.equal(retry.status,200);
    assert.deepEqual(retry.data.inquiry,first.data.inquiry);
    assert.equal((await post({...payload,gratuitySelection:{kind:"custom",amountCents:500}})).status,409);
    assert.equal((await post({...payload,bookingRequestId:crypto.randomUUID(),gratuitySelection:{kind:"none",amountCents:500}})).status,400);
    assert.equal((await post({...payload,bookingRequestId:crypto.randomUUID(),expectedAuthorizedTotalCents:1})).status,422);
    const saved=await getInquiryByBookingRequestId(input.bookingRequestId);
    assert.equal(saved?.status,"PAYMENT_PENDING");
    assert.equal(await getRideByInquiryId(saved!.id),null,"Unpaid booking remains out of dispatch");
    assert.equal(await prisma.inquiry.count({where:{email}}),1,"Retries and rejected totals do not create extra bookings");
    const password=crypto.randomUUID();
    const customer=await createAdmin({name:"Gratuity Account Fixture",email,password,role:"USER"});
    accountIds.push(customer.id);
    await prisma.inquiry.update({where:{id:saved!.id},data:{customerUserId:customer.id}});
    await finalizeAuthorizedInquiry(input.bookingRequestId,crypto.randomBytes(32).toString("hex"),new Date(Date.now()+86400000).toISOString());
    const legacy=await prisma.inquiry.create({data:{
      fullName:input.fullName,email,phone:input.phone,serviceType:input.serviceType,pickupAt:new Date(input.pickupAt),
      pickup:input.pickup,destination:input.destination,passengers:1,estimatedFareCents:12345,customerUserId:customer.id,status:"NEW",
    }});
    const login=await authenticate(email,password,"customer");
    assert.ok(login);
    const accountResponse=await fetch(origin+"/api/customer/bookings",{headers:{Cookie:`allan_customer_session=${login.token}`}});
    assert.equal(accountResponse.status,200);
    const accountData=await accountResponse.json();
    const tipped=accountData.bookings.find((item:any)=>item.id===saved!.id);
    assert.equal(tipped.fareCents,fare.fareCents);
    assert.equal(tipped.gratuityCents,1250);
    assert.equal(tipped.authorizedTotalCents,fare.fareCents+1250);
    const old=accountData.bookings.find((item:any)=>item.id===legacy.id);
    assert.equal(old.gratuityCents,0);
    assert.equal(old.authorizedTotalCents,12345,"Legacy account bookings fall back to their no-tip fare");
  } finally {
    globalThis.fetch=originalFetch;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await prisma.inquiry.deleteMany({where:{email}});
    await prisma.adminUser.deleteMany({where:{id:{in:accountIds}}});
    await prisma.$disconnect();
  }
});
