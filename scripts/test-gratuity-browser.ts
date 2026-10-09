import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Browser-only API fixtures: no real cards, booking writes, Maps calls, or SMS.
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}:5000`;
assert.ok(process.env.REPLIT_DEV_DOMAIN);
const profile = await mkdtemp(path.join(tmpdir(), "gratuity-browser-"));
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9447",
  `--user-data-dir=${profile}`, "--window-size=1360,1050", "about:blank",
], { stdio: "ignore" });
let socket: WebSocket | undefined;
let seq = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
let paymentFails = false;
let paymentDeclines = false;
let payload: any;
let paymentCalls = 0;
const requestIds: string[] = [];
function command(method: string, params: any = {}): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression: string) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression: string) {
  for (let i=0;i<120;i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Browser assertion timed out: ${expression}`);
}
async function click(text: string) {
  await evaluate(`(()=>{const el=[...document.querySelectorAll("#reserve button")].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!el||el.disabled)throw Error("Button unavailable");el.click()})()`);
}
async function input(selector: string, value: string) {
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error("Input unavailable");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event("input",{bubbles:true}))})()`);
}
async function review() {
  await command("Page.navigate",{url:origin+"/"});
  await wait('document.querySelector("#reserve input")');
  await evaluate(`(() => {
    const inputs = [document.getElementById("wizard-pickup-location"), document.getElementById("wizard-destination-location")];
    if (inputs.some(el => !el)) throw Error("Route inputs unavailable");
    inputs.forEach((el, i) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, i ? "Test destination" : "Test pickup");
      el.dispatchEvent(new Event("input", {bubbles:true}));
    });
  })()`);
  await wait('[...document.querySelectorAll("#reserve button")].some(x=>x.textContent.includes("See vehicles")&&!x.disabled)');
  await click("See vehicles");
  await wait('[...document.querySelectorAll("#reserve button")].some(x=>x.textContent.includes("Choose ")&&!x.disabled)');
  await click("Choose ");
  await wait('[...document.querySelectorAll("#reserve button")].some(x=>x.textContent.includes("Continue to payment")&&!x.disabled)');
  await click("Continue to payment");
  await wait('document.querySelector(".gratuity-options")');
  await evaluate('document.querySelector("#reserve").scrollIntoView()');
}
try {
  let tabs: any[] = [];
  for (let i=0;i<80;i++) {
    try { tabs=await (await fetch("http://127.0.0.1:9447/json")).json(); if(tabs.length)break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  socket = new WebSocket(tabs.find(x=>x.type==="page").webSocketDebuggerUrl);
  await new Promise<void>(resolve=>socket!.addEventListener("open",()=>resolve(),{once:true}));
  socket.addEventListener("message",event=>{
    const message=JSON.parse(String(event.data));
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(new Error(message.error.message));else p?.resolve(message.result);return;}
    if(message.method!=="Fetch.requestPaused")return;
    void (async()=>{
      const paused=message.params;
      const url=new URL(paused.request.url);
      let status=200;let data:any={};
      if(url.pathname==="/api/customer/session"){status=401;data={error:"Not signed in"};}
      else if(url.pathname==="/api/content") data={services:[],fleet:[],siteContent:{heroDescription:"Browser fixture"},companyProfile:{businessPhone:"312-555-0100",contactEmail:"test@example.invalid",serviceArea:"Chicago"}};
      else if(url.pathname==="/api/fare/calculate")data={fareCents:12345,miles:10,minutes:30};
      else if(url.pathname==="/api/stripe/config")data={configured:true,publishableKey:null};
      else if(url.pathname==="/api/inquiries"){
        payload=JSON.parse(paused.request.postData);
        requestIds.push(payload.bookingRequestId);
        const selection=payload.gratuitySelection;
        const tip=selection.kind==="none"?0:selection.kind==="custom"?selection.amountCents:Math.floor((12345*selection.percent+50)/100);
        assert.equal(payload.expectedAuthorizedTotalCents,12345+tip);
        data={inquiry:{id:"fixture-booking",estimatedFareCents:12345,grossFareCents:12345,promoDiscountCents:0,gratuityCents:tip,authorizedTotalCents:12345+tip},trackingToken:"a".repeat(64)};
      } else if(url.pathname==="/api/create-payment-intent"){
        paymentCalls++;
        const paymentPayload=JSON.parse(paused.request.postData);
        assert.equal(paymentPayload.expectedAuthorizedTotalCents,payload.expectedAuthorizedTotalCents);
        if(paymentDeclines){status=402;data={error:"Simulated definitive card decline",authorizationOutcome:"rejected"};}
        else if(paymentFails){status=502;data={error:"Simulated uncertain authorization",authorizationOutcome:"unknown"};}
        else data={status:"requires_capture",amount:payload.expectedAuthorizedTotalCents};
      } else {status=404;data={error:"Browser fixture endpoint unavailable"};}
      await command("Fetch.fulfillRequest",{requestId:paused.requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString("base64")});
    })().catch(error=>{console.error(error.message);process.exitCode=1;});
  });
  await command("Page.enable");
  await command("Network.enable");
  await command("Network.setBypassServiceWorker",{bypass:true});
  await command("Network.setBlockedURLs",{urls:["*maps.googleapis.com*","*maps.gstatic.com*","*stripe.com*","*google-analytics.com*"]});
  await command("Fetch.enable",{patterns:[{urlPattern:"*://*/api/*",requestStage:"Request"}]});
  await command("Page.addScriptToEvaluateOnNewDocument",{source:`localStorage.setItem("allan-booking-contact",JSON.stringify({fullName:"Browser Fixture",phone:"+13125550129",email:"browser@example.invalid"}));localStorage.setItem("allan-saved-payment",JSON.stringify({customerId:"cus_fixture",paymentMethodId:"pm_fixture",cardBrand:"visa",cardLast4:"4242",capability:"browser-fixture-not-real"}));navigator.geolocation.getCurrentPosition=(_,failure)=>failure({code:1,PERMISSION_DENIED:1});`});
  await review();
  assert.equal(await evaluate('document.querySelector(".gratuity-options input:checked").closest("label").textContent.includes("No gratuity")'),true);
  assert.equal(await evaluate('document.querySelector(".amount-total").textContent.includes("$123.45")'),true);
  await evaluate('[...document.querySelectorAll(".gratuity-options label")].find(x=>x.textContent.includes("15%")).querySelector("input").click()');
  await wait('document.querySelector(".amount-total").textContent.includes("$141.97")');
  await input('input[aria-label="Custom gratuity in dollars"]',"10.01");
  await wait('document.querySelector(".amount-total").textContent.includes("$133.46")');
  await input('input[aria-label="Custom gratuity in dollars"]',"1.001");
  await wait('document.querySelector(".wizard-instant-book").disabled');
  await input('input[aria-label="Custom gratuity in dollars"]',"10.01");
  await wait('!document.querySelector(".wizard-instant-book").disabled');
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.scrollTo({top:window.scrollY+document.querySelector(".gratuity-options").closest("section").getBoundingClientRect().top-90,behavior:"instant"})');
  const image=await command("Page.captureScreenshot",{format:"png"});
  await writeFile("/tmp/gratuity-mobile-review.png",Buffer.from(image.data,"base64"));
  assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true,"Mobile review must not overflow");
  paymentFails=true;
  await click("Authorize & book");
  await wait('document.querySelector(".gratuity-lock-note")');
  assert.equal(await evaluate('[...document.querySelectorAll("#reserve button")].find(x=>x.textContent.includes("Start a fresh booking")).disabled'),true);
  assert.equal(await evaluate('document.querySelector(".booking-review-fields").disabled'),true);
  paymentFails=false;
  await click("Retry authorization");
  await wait('document.querySelector(".wizard-success")');
  assert.equal(paymentCalls,2);
  assert.equal(new Set(requestIds).size,1,"Uncertain retries must keep the same booking request");
  assert.equal(await evaluate('document.querySelector(".booking-success-amounts").textContent.includes("$10.01")'),true);
  await click("Book another ride");
  await click("See vehicles");
  await wait('[...document.querySelectorAll("#reserve button")].some(x=>x.textContent.includes("Choose ")&&!x.disabled)');
  await click("Choose ");
  await click("Continue to payment");
  await wait('document.querySelector(".gratuity-options")');
  assert.equal(await evaluate('document.querySelector(".gratuity-options input:checked").closest("label").textContent.includes("No gratuity")'),true);
  paymentDeclines=true;
  await click("Authorize & book");
  await wait('document.querySelector(".gratuity-lock-note")');
  assert.equal(await evaluate('[...document.querySelectorAll("#reserve button")].find(x=>x.textContent.includes("Start a fresh booking")).disabled'),false,"A definitive decline permits a fresh request");
  await click("Start a fresh booking");
  await click("See vehicles");
  await wait('[...document.querySelectorAll("#reserve button")].some(x=>x.textContent.includes("Choose ")&&!x.disabled)');
  await click("Choose ");
  await click("Continue to payment");
  await wait('document.querySelector(".booking-review-fields")');
  assert.equal(await evaluate('document.querySelector(".booking-review-fields").disabled'),false,"Card editing must be available on the fresh booking");
  paymentDeclines=false;
  await click("Authorize & book");
  await wait('document.querySelector(".wizard-success")');
  assert.equal(new Set(requestIds).size,3,"A declined attempt is replaced only by an explicitly fresh request");
  console.log("Browser passed: default no-tip, percentage/custom totals, invalid input, mobile fit, locked uncertain outcome, same-request retry, tipped confirmation, definitive-decline recovery and editable fresh booking.");
} finally {
  socket?.close();browser.kill("SIGTERM");
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
