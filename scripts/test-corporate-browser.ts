import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// All API requests are intercepted. This creates no real accounts, mail or charges.
assert.ok(process.env.REPLIT_DEV_DOMAIN);
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}:5000`;
const profile = await mkdtemp(path.join(tmpdir(), "corporate-browser-"));
const browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9449", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let socket: WebSocket | undefined, seq = 0, applicationBody: any, quoteBody: any;
let failBooking = true;
const bookingTokens: string[] = [], pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const account = {
  id: "browser-company", companyLegalName: "Browser Fixture Company", contactName: "Fixture Contact",
  contactEmail: "browser@example.invalid", contactPhone: "+13125550199", monthlyRideVolume: 12,
  billingPreference: "EMAIL_RECEIPTS", billingName: "Fixture Billing", billingEmail: "billing@example.invalid",
  billingAddress: "123 Fixture Street", status: "ACTIVE", createdAt: new Date().toISOString(),
  paymentReady: true, mustChangePassword: false, credentialsEmailStatus: "SENT", approvedAt: new Date().toISOString(), rejectionReason: null,
};
const booking = { id: "browser-ride", reference: "FIXTURE", pickup: "Fixture Pickup", destination: "Fixture Destination",
  pickupAt: new Date(Date.now() + 86400000).toISOString(), fullName: "Fixture Passenger", status: "IN_PROGRESS",
  fareCents: 12300, gratuityCents: 0, authorizedTotalCents: 12300, paymentStatus: "requires_action", poNumber: "PO-FIXTURE", costCenterCode: "CC-FIXTURE" };
function command(method: string, params: any = {}) {
  const id = ++seq; socket!.send(JSON.stringify({ id, method, params }));
  return new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression: string) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value;
}
async function wait(expression: string) {
  for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(r => setTimeout(r, 100)); }
  const invalid = await evaluate('Array.from(document.querySelectorAll("form input,form textarea")).filter(e=>!e.checkValidity()).map(e=>({label:e.closest("label")?.textContent,type:e.type,message:e.validationMessage}))');
  const text = await evaluate('document.body.textContent.slice(-1100)');
  throw Error(`Browser assertion timed out: ${expression}; invalid=${JSON.stringify(invalid)}; page=${text}`);
}
async function click(text: string) {
  await evaluate(`(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!b||b.disabled)throw Error("Button unavailable");b.click()})()`);
}
try {
  let tabs: any[] = [];
  for (let i = 0; i < 80; i++) { try { tabs = await (await fetch("http://127.0.0.1:9449/json")).json(); if (tabs.length) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  socket = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise<void>(resolve => socket!.addEventListener("open", () => resolve(), { once: true }));
  socket.addEventListener("message", async event => {
    const message = JSON.parse(String(event.data));
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (p) message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); return; }
    if (message.method !== "Fetch.requestPaused") return;
    const { request, requestId } = message.params; const url = new URL(request.url); let body: any = {}, status = 200;
    if (url.pathname === "/api/corporate/applications") {
      applicationBody = JSON.parse(request.postData); body = { application: { id: account.id, status: "PENDING" }, applicationToken: applicationBody.applicationToken };
    } else if (url.pathname.includes("/payment-setup")) { status = 503; body = { error: "Fixture checkout intentionally not opened." };
    } else if (url.pathname === "/api/corporate/session") body = { user: { id: "fixture-customer", name: account.contactName, email: account.contactEmail, role: "USER" }, account };
    else if (url.pathname === "/api/corporate/quotes") { quoteBody = JSON.parse(request.postData); body = { quoteToken: "browser-only-reviewed-token", fareCents: 12300, gratuityCents: 0, totalCents: 12300 };
    } else if (url.pathname === "/api/corporate/bookings" && request.method === "POST") {
      bookingTokens.push(JSON.parse(request.postData).quoteToken);
      if (failBooking) { failBooking = false; status = 503; body = { error: "Simulated uncertain booking." }; } else body = { booking };
    } else if (url.pathname === "/api/corporate/bookings") body = { bookings: [booking] };
    else if (url.pathname === "/api/admin/session") body = { user: { id: "fixture-staff", role: "SUPER_ADMIN", name: "Fixture Staff", permissions: [] } };
    else if (url.pathname === "/api/admin/corporate/accounts") body = { accounts: [{ ...account, status: "PENDING" }], nextCursor: null };
    else body = { notifications: [], unreadCount: 0, rides: [], content: {}, services: [], fleet: [] };
    await command("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
  await command("Page.enable"); await command("Runtime.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: `${origin}/corporate` }); await wait('document.querySelector(".corp-consent input")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".corp-page")).backgroundColor'), "rgb(5, 6, 6)");
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".corp-page"),"::before").animationName'), "corp-sapphire-bloom");
  await wait('document.querySelector(".corp-page").getAnimations({subtree:true}).some(a=>a.animationName==="corp-sapphire-bloom"&&a.playState==="running")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".corp-form input")).backgroundColor'), "rgb(13, 17, 21)");
  assert.ok(await evaluate('(()=>{const v=document.querySelector(".corp-hero-video");return v?.muted&&v.loop&&v.autoplay&&v.playsInline&&Boolean(v.poster)})()'));
  await wait('document.querySelector(".corp-hero-video").readyState>=2');
  await wait('document.querySelector(".corp-motion-toggle").getAttribute("aria-label")==="Pause hero video"');
  await click("Pause motion"); await wait('document.querySelector(".corp-hero-video").paused');
  await click("Play motion"); await wait('!document.querySelector(".corp-hero-video").paused');
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait('!document.querySelector(".corp-hero-video")&&document.querySelector(".corp-hero-poster")');
  await wait('getComputedStyle(document.querySelector(".corp-page"),"::before").animationName==="none"');
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await wait('document.querySelector(".corp-hero-video")');
  assert.equal(await evaluate('document.querySelector(".corp-consent input").checked'), false);
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
  await evaluate(`(()=>{for(const e of document.querySelectorAll("form input,form textarea")){if(e.type==="checkbox"){e.click();continue}const label=e.closest("label").textContent.toLowerCase();const value=e.type==="email"?"fixture@example.invalid":e.type==="tel"?"+13125550199":e.type==="number"?"12":label.includes("address")?"123 Fixture Street, Chicago":"Fixture Company";Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,value);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}})()`);
  await click("Submit for review"); await wait('document.body.textContent.includes("Application received")');
  await click("Set up company payment method"); await wait('document.body.textContent.includes("Fixture checkout intentionally")');
  assert.ok(applicationBody.billingConsent); assert.match(applicationBody.applicationToken, /^[a-f0-9]{64}$/);
  assert.equal(await evaluate(`sessionStorage.getItem("allan-corporate-application:${account.id}")`), applicationBody.applicationToken);
  assert.equal("cardNumber" in applicationBody, false);
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `${origin}/corporate/portal` }); await wait('document.body.textContent.includes("Authorize company card")');
  assert.ok(await evaluate('document.body.textContent.includes("PO-FIXTURE")&&document.body.textContent.includes("CC-FIXTURE")'));
  await evaluate(`(()=>{for(const e of document.querySelectorAll("form input")){const label=e.closest("label").textContent.toLowerCase();if(!e.required)continue;let value=e.type==="datetime-local"?new Date(Date.now()+86400000).toISOString().slice(0,16):e.type==="tel"?"+13125550198":e.type==="number"?"2":label.includes("cost")?"CC-FIXTURE":label.includes("order")||label.includes("po number")?"PO-FIXTURE":label.includes("destination")?"Fixture Destination":label.includes("pickup")?"Fixture Pickup":"Fixture Passenger";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,value);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}})()`);
  await click("Review"); await wait('document.querySelector(".corp-quote")');
  assert.equal(quoteBody.poNumber, "PO-FIXTURE"); assert.equal(quoteBody.costCenterCode, "CC-FIXTURE");
  await click("Confirm"); await wait('document.body.textContent.includes("Simulated uncertain booking")');
  assert.ok(await evaluate('document.body.textContent.includes("retry this same reviewed booking")'));
  await click("Retry"); await wait('!document.querySelector(".corp-quote")');
  assert.equal(bookingTokens.length, 2); assert.equal(bookingTokens[0], bookingTokens[1]);
  await command("Page.navigate", { url: `${origin}/admin/corporate` }); await wait('document.body.textContent.includes("Company accounts")');
  await wait('document.body.textContent.includes("Browser Fixture Company")');
  assert.ok(await evaluate('document.body.textContent.includes("Approve")'));
  console.log("Corporate browser checks passed: video playback/pause/reduced motion, phone consent/layout, application capability, portal tags, SCA recovery control, immutable booking retries and staff review. All APIs simulated.");
} finally {
  socket?.close(); browser.kill(); await new Promise(r => setTimeout(r, 250)); await rm(profile, { recursive: true, force: true });
}
