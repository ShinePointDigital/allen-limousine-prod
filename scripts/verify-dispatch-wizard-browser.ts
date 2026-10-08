import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../server/store.js";
import { applicationDatabaseUrl } from "../server/database-config.js";
import { SMS_CONSENT_AUTHOR, smsConsentAuditBody } from "../shared/sms-consent.js";

if (!process.argv.includes("--development-database") || !applicationDatabaseUrl()) throw new Error("Browser verification requires isolated development mode.");
const domain = process.env.REPLIT_DEV_DOMAIN;
if (!domain) throw new Error("Development preview domain is required.");
// The project's mapped external HTTP port is 5000; the default domain serves Vite HMR.
const origin = `https://${domain}:5000`;
let actorId: string | undefined, bookingId: string | undefined, driverId: string | undefined, vehicleId: string | undefined;
const email = `${crypto.randomUUID()}@example.invalid`;
const password = "browser-test-only-password";
let socket: WebSocket | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
function command(method: string, params: object = {}): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression: string) {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
async function waitFor(expression: string) {
  for (let retry = 0; retry < 120; retry++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for UI condition: ${expression}`);
}
async function clickButton(text: string) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Requested button is unavailable'); b.click(); })()`);
}
async function screenshot(name: string) {
  await new Promise(resolve => setTimeout(resolve, 300));
  const shot = await command("Page.captureScreenshot", { format: "jpeg", quality: 75, captureBeyondViewport: false });
  await mkdir("screenshots", { recursive: true });
  await writeFile(`screenshots/${name}.jpg`, Buffer.from(shot.data, "base64"));
}
try {
  const actor = await prisma.adminUser.create({ data: { name: "Browser Verification", email, passwordHash: await bcrypt.hash(password, 4), role: "ADMIN", permissions: ["dashboard", "rides", "inquiries"] } });
  actorId = actor.id;
  const driver = await prisma.chauffeur.create({ data: { name: "Browser Test Chauffeur", phone: "+13125550788" } });
  driverId = driver.id;
  const vehicle = await prisma.fleetVehicle.create({ data: { name: "Browser Test Vehicle", category: "Sedan", description: "Temporary test fixture", imageUrl: "/test.jpg", passengers: "3", luggage: "2" } });
  vehicleId = vehicle.id;
  const booking = await prisma.inquiry.create({ data: { fullName: "Browser Test Client", phone: "+13125550789", email: "browser-client@example.invalid", pickup: "Test pickup", destination: "Test drop-off", pickupAt: new Date(Date.now() + 300_000), passengers: 1, serviceType: "Point-to-Point", rateTier: "SEDAN", paymentStatus: "authorized" } });
  bookingId = booking.id;
  await prisma.inquiryNote.create({ data: { inquiryId: booking.id, authorName: SMS_CONSENT_AUTHOR, body: smsConsentAuditBody(false, booking.phone) } });
  const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json() as { type: string; webSocketDebuggerUrl: string }[];
  socket = new WebSocket(targets.find(target => target.type === "page")!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve(), { once: true }); socket!.addEventListener("error", () => reject(new Error("Unable to connect to Chromium")), { once: true }); });
  socket.addEventListener("message", event => {
    const response = JSON.parse(String(event.data));
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    response.error ? entry.reject(new Error(response.error.message)) : entry.resolve(response.result);
  });
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `${origin}/admin/login` });
  await waitFor(`document.querySelector('input[type="password"]') !== null`);
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [selector,value] of [['input[type="email"]',${JSON.stringify(email)}],['input[type="password"]',${JSON.stringify(password)}]]) {
      const input = document.querySelector(selector); set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  })()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  await evaluate(`document.querySelector('input[type="password"]').closest('form').requestSubmit()`);
  await waitFor(`document.querySelector('.inquiry-row') && document.body.textContent.includes('Browser Test Client')`);
  await evaluate(`[...document.querySelectorAll('.inquiry-row')].find(row => row.textContent.includes('Browser Test Client')).click()`);
  await waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Confirm review')`);
  await clickButton("Confirm review");
  await waitFor(`document.querySelectorAll('[role="dialog"] select').length === 2`);
  await screenshot("dispatch-wizard-assignment-desktop");
  await evaluate(`document.querySelector('[aria-label="Close dispatch dialog"]').click()`);
  await waitFor(`document.querySelector('[role="dialog"]') === null`);
  await evaluate(`[...document.querySelectorAll('.inquiry-row')].find(row => row.textContent.includes('Browser Test Client')).click()`);
  await waitFor(`document.querySelectorAll('[role="dialog"] select').length === 2`);
  await evaluate(`(() => {
    const selects = document.querySelectorAll('[role="dialog"] select');
    selects[0].value=${JSON.stringify(driver.id)}; selects[0].dispatchEvent(new Event('change',{bubbles:true}));
    selects[1].value=${JSON.stringify(vehicle.id)}; selects[1].dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await clickButton("Save assignment");
  await waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Confirm & dispatch')`);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Client has not opted in to SMS.')`), true);
  await screenshot("dispatch-wizard-sms-desktop");
  await command("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await screenshot("dispatch-wizard-sms-mobile");
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, "Mobile must not overflow horizontally.");
  assert.equal(await evaluate(`(() => { const r=document.querySelector('.dw-footer .dw-button-primary').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight; })()`), true, "Dispatch confirmation must stay visible while the SMS previews scroll.");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dw-footer .dw-button-primary')).color`), "rgb(244, 240, 232)", "Admin page styles must not hide the primary button label against its dark background.");
  // No dispatch button is clicked: live Twilio and Stripe are never contacted.
  await command("Page.navigate", { url: `${origin}/admin/inquiries?inquiry=${booking.id}` });
  await waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Confirm & dispatch')`);
  const saved = await prisma.inquiry.findUniqueOrThrow({ where: { id: booking.id }, include: { ride: { include: { dispatchMessages: true } } } });
  assert.equal(saved.dispatchStep, 3);
  assert.equal(saved.ride?.driverId, driver.id);
  assert.equal(saved.ride?.vehicleId, vehicle.id);
  assert.equal(saved.ride?.dispatchMessages.length, 0);
  console.log("Browser verified: real sign-in, card opening, review persistence, close/reopen resume, assignment dropdowns/save, SMS previews, deep-link resume and mobile width. No SMS or payment submitted.");
} finally {
  socket?.close();
  if (bookingId) await prisma.inquiry.delete({ where: { id: bookingId } });
  if (driverId) await prisma.chauffeur.delete({ where: { id: driverId } });
  if (vehicleId) await prisma.fleetVehicle.delete({ where: { id: vehicleId } });
  if (actorId) await prisma.adminUser.delete({ where: { id: actorId } });
  await prisma.$disconnect();
}
