import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

// Browser fixtures intercept every API request. No cards, bookings or SMS are sent.
assert.ok(process.env.REPLIT_DEV_DOMAIN);
const origin=`https://${process.env.REPLIT_DEV_DOMAIN}:5000`;
const profile=await mkdtemp(path.join(tmpdir(),"driver-trip-browser-"));
const browser=spawn("/repl/tools/bin/chromium",["--headless","--no-sandbox","--disable-gpu","--remote-debugging-port=9448",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let socket:WebSocket|undefined;let seq=0;
const pending=new Map<number,{resolve(value:any):void;reject(error:Error):void}>();
let failCapture=true;let charges=0;let expired=false;
const trip={reference:"BROWSER",customerName:"Browser Fixture",chauffeurName:"Alex",vehicleName:"Fixture SUV",
  pickupAt:"2026-10-10T15:00:00.000Z",pickup:"Test pickup, Chicago",destination:"Test destination, Chicago",
  serviceType:"Point-to-Point",passengers:2,status:"ASSIGNED",paymentStatus:"requires_capture",
  fareCents:8500,gratuityCents:1275,authorizedTotalCents:9775,hasCardAuthorization:true,
  airportCode:"DFW",airportTerminal:"C",flightNumber:"AA123",airlineName:"American Airlines",
  flightScheduledAt:"2026-10-15T16:00:00.000Z",pickupPreference:"Baggage Claim Meet & Greet with Name Sign",
  isPrivateFBO:false,specificTailNumber:null,principalName:null,fboName:null,tarmacInstructions:null};

// Include legacy financial fields in the intercepted fixture to prove that the
// driver UI ignores them even during a rolling deployment with an older API.
async function assertNoFinancialDetails(){
  assert.equal(await evaluate('document.querySelector("#driver-trip-payment-heading, .driver-trip-confirm-amounts") !== null'),false);
  assert.doesNotMatch(await evaluate('document.body.innerText'),/\$|payment status|card total|fare|gratuity|authorized total|captured/i);
}
function command(method:string,params:any={}):Promise<any>{
  const id=++seq;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket!.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression:string){
  const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;
}
async function wait(expression:string){
  for(let i=0;i<100;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Browser assertion timed out: ${expression}`);
}
async function click(text:string){
  await evaluate(`(()=>{const el=[...document.querySelectorAll("button")].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!el||el.disabled)throw Error("Button unavailable");el.click()})()`);
}
async function screenshot(name:string){
  const image=await command("Page.captureScreenshot",{format:"jpeg",quality:80,captureBeyondViewport:true});
  await writeFile(`generated-artifacts/${name}.jpg`,Buffer.from(image.data,"base64"));
}
try{
  let tabs:any[]=[];
  for(let i=0;i<80;i++){try{tabs=await(await fetch("http://127.0.0.1:9448/json")).json();if(tabs.length)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  socket=new WebSocket(tabs.find(x=>x.type==="page").webSocketDebuggerUrl);
  await new Promise<void>(resolve=>socket!.addEventListener("open",()=>resolve(),{once:true}));
  socket.addEventListener("message",event=>{
    const message=JSON.parse(String(event.data));
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(new Error(message.error.message));else p?.resolve(message.result);return;}
    if(message.method!=="Fetch.requestPaused")return;
    void(async()=>{
      const paused=message.params;const url=new URL(paused.request.url);
      let status=200;let data:any={};
      if(url.pathname.startsWith("/api/driver/trips/")){
        if(expired){status=404;data={error:"Synthetic expired link"};}
        else if(paused.request.method==="POST"){
          const next=JSON.parse(paused.request.postData).status;
          if(next==="COMPLETED"&&failCapture){failCapture=false;status=402;data={error:"Synthetic uncertain capture"};}
          else {trip.status=next;if(next==="COMPLETED"){trip.paymentStatus="succeeded";charges++;}data={trip};}
        }else data={trip};
      }else{status=401;data={error:"Browser fixture prevents real API operations"};}
      await command("Fetch.fulfillRequest",{requestId:paused.requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString("base64")});
    })().catch(error=>{for(const p of pending.values())p.reject(error);});
  });
  await command("Page.enable");await command("Runtime.enable");
  await command("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await command("Page.navigate",{url:`${origin}/driver/trip/${"e".repeat(64)}`});
  await wait('document.querySelector(".driver-trip-action")');
  assert.match(await evaluate('document.querySelector("#driver-trip-return-reminder").textContent'),/After navigation, return to this trip page to confirm pickup or completion/);
  assert.match(await evaluate('document.querySelector("#driver-trip-return-reminder").textContent'),/original tab.*SMS.*safely parked/);
  assert.equal(await evaluate('document.querySelector(".driver-trip-nav-links").getAttribute("aria-describedby")'),"driver-trip-return-reminder");
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".driver-trip-nav-links a")).every(link => link.target === "_blank" && link.rel.includes("noopener") && link.rel.includes("noreferrer"))'),true,"Navigation must keep the original driver trip page open");
  await assertNoFinancialDetails();
  const airportText=await evaluate('document.querySelector("#driver-trip-airport-heading").closest("section").textContent');
  for(const detail of ["DFW","Booked terminal","C","AA123","American Airlines","Booked flight time","CDT","Baggage Claim Meet & Greet with Name Sign"]){
    assert.ok(airportText.includes(detail),`Driver airport section should show ${detail}`);
  }
  assert.ok(airportText.includes("not live flight updates"));
  assert.equal(await evaluate('document.querySelector(".pwa-install-gate") !== null'),false);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".driver-trip-main")).fontStyle'),"normal");
  assert.equal(await evaluate('document.querySelector(\'meta[name="referrer"]\').content'),"no-referrer");
  assert.equal(await evaluate('document.querySelectorAll(".driver-trip-nav-links a").length'),3);
  await evaluate(`(()=>{const el=document.querySelector("#driver-navigation-stop");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,"dropoff");el.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  await wait('document.querySelector(".driver-trip-nav-links a").href.includes("Test%20destination")');
  await mkdir("generated-artifacts",{recursive:true});
  await screenshot("driver-trip-mobile");
  await click("Confirm — en route");
  await wait('document.querySelector(".driver-trip-action").textContent.includes("passenger picked up")');
  await assertNoFinancialDetails();
  await click("Confirm passenger picked up");
  await wait('document.querySelector(".driver-trip-action").textContent.includes("Complete trip")');
  await assertNoFinancialDetails();
  await click("Complete trip");
  await wait('document.querySelector(".driver-trip-confirm")');
  assert.equal(charges,0,"Opening the completion dialog must not capture");
  await assertNoFinancialDetails();
  await click("Not yet");
  await wait('!document.querySelector(".driver-trip-confirm")');
  assert.equal(charges,0,"Cancelling confirmation must not capture");
  await click("Complete trip");
  await wait('document.querySelector(".driver-trip-confirm")');
  await screenshot("driver-trip-completion-confirmation");
  await click("Confirm drop-off");
  await wait('document.querySelector(".driver-trip-error")');
  assert.equal(trip.status,"IN_PROGRESS");assert.equal(charges,0);
  assert.match(await evaluate('document.querySelector(".driver-trip-error").textContent'),/could not be confirmed/);
  await assertNoFinancialDetails();
  await click("Complete trip");await wait('document.querySelector(".driver-trip-confirm")');
  await click("Confirm drop-off");
  await wait('!document.querySelector(".driver-trip-action")&&document.body.textContent.includes("This trip is complete")');
  assert.equal(charges,1);
  await assertNoFinancialDetails();
  await command("Emulation.setDeviceMetricsOverride",{width:1360,height:1000,deviceScaleFactor:1,mobile:false});
  await assertNoFinancialDetails();
  await screenshot("driver-trip-desktop-completed");
  Object.assign(trip,{airportCode:"DAL",airportTerminal:null,flightNumber:null,airlineName:null,flightScheduledAt:null,
    pickupPreference:null,isPrivateFBO:true,specificTailNumber:"N123TEST",principalName:"Private aviation fixture",
    fboName:"Test FBO",tarmacInstructions:"Wait for the ramp escort.\nDo not enter the ramp alone."});
  await click("Refresh");
  await wait('document.body.innerText.includes("N123TEST")');
  const privateText=await evaluate('document.querySelector("#driver-trip-airport-heading").closest("section").textContent');
  for(const detail of ["DAL","Private aviation","N123TEST","Private aviation fixture","Test FBO","Wait for the ramp escort."]){
    assert.ok(privateText.includes(detail));
  }
  assert.doesNotMatch(privateText,/Booked terminal|Flight number|Booked flight time/);
  await assertNoFinancialDetails();
  await screenshot("driver-trip-private-airport");
  Object.assign(trip,{airportCode:null,isPrivateFBO:false,specificTailNumber:null,principalName:null,fboName:null,tarmacInstructions:null});
  await click("Refresh");
  await wait('!document.querySelector("#driver-trip-airport-heading")');
  await assertNoFinancialDetails();
  expired=true;await click("Refresh");await wait('document.body.textContent.includes("This trip link is unavailable")');
  console.log("Driver browser flow passed: booked flight/airport details, private aviation, missing details, financial privacy, app choices, phone layout, confirmation, capture failure/retry, completed state and expired link. No real API operations.");
}finally{
  socket?.close();
  const stopped=new Promise<void>(resolve=>browser.once("exit",()=>resolve()));
  browser.kill("SIGTERM");
  await Promise.race([stopped,new Promise<void>(resolve=>setTimeout(resolve,3000))]);
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
