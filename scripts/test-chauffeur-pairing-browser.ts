import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { applicationDatabaseUrl } from "../server/database-config.js";
import { prisma } from "../server/store.js";

// Only synthetic fixtures in the guarded development database may be changed.
assert.ok(process.argv.includes("--development-database"));
assert.ok(applicationDatabaseUrl());
const origin = process.env.PAIRING_TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}:5000`;
const host = new URL(origin).hostname;
assert.ok(host.endsWith(".replit.dev") || ["localhost", "127.0.0.1"].includes(host), "Browser smoke tests require a development app.");
const marker = `PairSmoke-${crypto.randomUUID().slice(0, 8)}`;
const password = crypto.randomUUID();
const bookingIds: string[] = [];
const driverIds: string[] = [];
const vehicleIds: string[] = [];
let actorId: string | undefined;
const profile = await mkdtemp(path.join(tmpdir(), "pairing-browser-"));
const browser = spawn(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket: WebSocket | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();

async function command(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15000);
    pending.set(id, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression: string): Promise<any> {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}
async function button(text: string, root = ".dw-dialog") {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(root + " button")})].find(el => el.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error("Button unavailable: " + ${JSON.stringify(text)});
    const scroller = button.closest(".dw-content");
    if (scroller) scroller.scrollTop += button.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
    button.click();
  })()`);
}
async function field(text: string, value: string, root = ".cvs-root") {
  await evaluate(`(() => {
    const label = [...document.querySelectorAll(${JSON.stringify(root + " label")})].find(el => el.childNodes[0]?.textContent.trim() === ${JSON.stringify(text)});
    const input = label?.querySelector("input,select,textarea");
    if (!input) throw new Error("Field missing: " + ${JSON.stringify(text)});
    const prototype = input.tagName === "SELECT" ? HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,"value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", {bubbles:true}));
  })()`);
}
async function screenshot(name: string) {
  const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const destination = path.join(tmpdir(), `${marker}-${name}.png`);
  await writeFile(destination, Buffer.from(data, "base64"));
  console.log(`Screenshot: ${destination}`);
}
async function navigate(route: string) {
  await command("Page.navigate", { url: origin + route });
}
async function openBooking(index: number) {
  await navigate("/admin/rides");
  const name = `${marker}-Booking-${index}`;
  await wait(`[...document.querySelectorAll("button.ride-row")].some(el=>el.textContent.includes(${JSON.stringify(name)}))`);
  await evaluate(`(() => {
    // Belt-and-braces protection: this test never authorizes SMS submission.
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (url, init) => {
      if (String(url).includes("/assign") && init?.body) {
        const payload = JSON.parse(init.body);
        if (payload.action === "dispatch") throw new Error("Live SMS blocked by browser smoke test");
        window.pairingAssignmentPayload = payload;
      }
      return fetchOriginal(url,init);
    };
    [...document.querySelectorAll("button.ride-row")].find(el=>el.textContent.includes(${JSON.stringify(name)})).click();
  })()`);
  await wait(`Boolean(document.querySelector(".dw-dialog #dw-review-heading"))`);
  await button("Confirm review");
  await wait(`Boolean(document.querySelector("#dw-assignment-heading"))`);
  assert.equal(await evaluate(`document.querySelectorAll(".dw-driver-select-grid select").length`), 1);
  assert.equal(await evaluate(`document.querySelector(".cvs-open").disabled`), false);
}
async function phone() {
  for (;;) {
    const value = `+120255501${crypto.randomInt(0, 100).toString().padStart(2, "0")}`;
    if (!await prisma.chauffeur.findUnique({ where: { phone: value } })) return value;
  }
}
async function newVehicleDetails(index: number) {
  await evaluate(`[...document.querySelectorAll(".cvs-radio-choice")].find(el=>el.textContent.includes("Create a new vehicle")).querySelector("input").click()`);
  await field("Vehicle name", `${marker}-Vehicle-${index}`);
  await field("Category", "Sedan");
  await field("Description", "Synthetic browser test vehicle");
  await field("Vehicle image URL", "https://example.invalid/car.jpg");
  await field("Passenger capacity", "3");
  await field("Luggage capacity", "2");
}

try {
  const debuggerUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chromium did not start")), 15000);
    browser.once("error", reject);
    browser.stderr!.on("data", data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const debuggerOrigin = `http://${new URL(debuggerUrl).host}`;
  const tab = await (await fetch(`${debuggerOrigin}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve()); socket!.addEventListener("error", () => reject(new Error("Browser connection failed"))); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const actor = await prisma.adminUser.create({ data: {
    name: marker, email: `${marker.toLowerCase()}@example.invalid`, role: "ADMIN", permissions: ["rides", "fleet"],
    passwordHash: await bcrypt.hash(password, 4),
  } });
  actorId = actor.id;
  for (let index = 1; index <= 4; index++) {
    const booking = await prisma.inquiry.create({ data: {
      fullName: `${marker}-Booking-${index}`, email: `${marker}@example.invalid`, phone: "+12025550189",
      serviceType: "Point-to-Point", pickupAt: new Date(Date.now() + 86400000), pickup: "Synthetic test pickup",
      destination: "Synthetic test destination", passengers: 1, paymentStatus: "authorized",
      ride: { create: { status: "UNASSIGNED" } },
    } });
    bookingIds.push(booking.id);
  }
  await navigate("/admin/login");
  await wait(`Boolean(document.querySelector("input[type=email]"))`);
  await field("Email address", actor.email, ".login-form");
  await field("Password", password, ".login-form");
  await button("Sign in", ".login-form");
  await wait(`location.pathname.startsWith("/admin") && location.pathname !== "/admin/login"`);

  // All four combinations use the same public, authenticated pairing flow.
  for (let index = 1; index <= 4; index++) {
    const existingDriver = index === 2 || index === 4;
    const existingVehicle = index === 2 || index === 3;
    let driverId: string | undefined;
    let vehicleId: string | undefined;
    if (existingDriver) {
      const driver = await prisma.chauffeur.create({ data: { name: `${marker}-Driver-${index}`, phone: await phone() } });
      driverIds.push(driver.id); driverId = driver.id;
    }
    if (existingVehicle) {
      const vehicle = await prisma.fleetVehicle.create({ data: {
        name: `${marker}-Vehicle-${index}`, category: "Sedan", description: "Synthetic test vehicle",
        imageUrl: "https://example.invalid/car.jpg", passengers: "3", luggage: "2",
      } });
      vehicleIds.push(vehicle.id); vehicleId = vehicle.id;
    }
    if (index === 1) {
      // Set mobile emulation before navigation so Chromium processes the viewport meta tag.
      await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    }
    await openBooking(index);
    await button("Add or pair");
    if (existingDriver) {
      await button("Pair existing", ".cvs-root");
      await field("Unlinked chauffeur", driverId!);
    } else {
      await field("Chauffeur name", `${marker}-Driver-${index}`);
      await field("Phone number", await phone());
    }
    if (existingVehicle) await field("Available vehicle", vehicleId!);
    else await newVehicleDetails(index);
    if (index === 1) {
      await wait("document.querySelector('.dw-backdrop').getBoundingClientRect().width <= 390");
      assert.equal(await evaluate(`document.querySelector(".dw-dialog").scrollWidth <= document.querySelector(".dw-dialog").clientWidth + 1`), true);
      assert.equal(await evaluate(`document.querySelector(".cvs-root").scrollWidth <= document.querySelector(".cvs-root").clientWidth + 1`), true);
      await evaluate(`(() => { const scroller=document.querySelector(".dw-content"); scroller.scrollTop += document.querySelector(".cvs-vehicle-fields").getBoundingClientRect().top - scroller.getBoundingClientRect().top; })()`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.equal(await evaluate(`(() => { const rect=document.querySelector(".dw-dialog").getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= 844; })()`), true);
      assert.equal(await evaluate(`(() => { const rect=document.querySelector(".dw-footer").getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= 844; })()`), true);
      await screenshot("mobile-vehicle-fields");
      await evaluate(`(() => { const scroller=document.querySelector(".dw-content"); scroller.scrollTop += document.querySelector(".cvs-root").getBoundingClientRect().top - scroller.getBoundingClientRect().top; })()`);
      await screenshot("mobile-setup");
      await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    }
    await button(existingDriver ? "Save vehicle pairing" : "Add chauffeur & vehicle", ".cvs-root");
    await wait(`!document.querySelector(".cvs-form")`);
    const driver = await prisma.chauffeur.findFirstOrThrow({ where: { name: `${marker}-Driver-${index}` } });
    driverId = driver.id; driverIds.push(driver.id);
    vehicleId = driver.fleetVehicleId!;
    vehicleIds.push(vehicleId);
    assert.equal(await evaluate(`document.querySelector(".dw-driver-select-grid select").value`), driver.id);
    assert.ok(await evaluate(`document.querySelector(".dw-assignment-summary").textContent.includes(${JSON.stringify(`${marker}-Vehicle-${index}`)})`));
    assert.equal((await prisma.ride.findUniqueOrThrow({ where: { inquiryId: bookingIds[index - 1] } })).vehicleId, null);
    if (index === 1) await screenshot("desktop-pair-selected");
    await button("Save assignment");
    await wait(`Boolean(document.querySelector("#dw-notifications-heading"))`);
    assert.equal(await evaluate(`"vehicleId" in window.pairingAssignmentPayload`), false);
    assert.equal(await evaluate(`window.pairingAssignmentPayload.driverId`), driverId);
    const ride = await prisma.ride.findUniqueOrThrow({ where: { inquiryId: bookingIds[index - 1] } });
    assert.equal(ride.driverId, driverId);
    assert.equal(ride.vehicleId, vehicleId);
    assert.equal(await prisma.dispatchMessage.count({ where: { rideId: ride.id } }), 0);
    console.log(`PASS pairing combination ${index}: ${existingDriver ? "existing" : "new"} chauffeur + ${existingVehicle ? "existing" : "new"} vehicle`);
  }

  // A legacy saved assignment remains exact and locked after a pending notification.
  const ride = await prisma.ride.findUniqueOrThrow({ where: { inquiryId: bookingIds[0] } });
  await prisma.chauffeur.update({ where: { id: ride.driverId! }, data: { fleetVehicleId: null } });
  await navigate("/admin/rides");
  await wait(`[...document.querySelectorAll("button.ride-row")].some(el=>el.textContent.includes(${JSON.stringify(`${marker}-Booking-1`)}))`);
  await evaluate(`[...document.querySelectorAll("button.ride-row")].find(el=>el.textContent.includes(${JSON.stringify(`${marker}-Booking-1`)})).click()`);
  await wait(`Boolean(document.querySelector("#dw-notifications-heading"))`);
  await button("Back");
  await wait(`Boolean(document.querySelector("#dw-assignment-heading"))`);
  assert.ok(await evaluate(`document.querySelector(".dw-assignment-summary").textContent.includes(${JSON.stringify(`${marker}-Vehicle-1`)})`));
  assert.ok(await evaluate(`document.querySelector(".dw-lock-note").textContent.includes("saved legacy assignment")`));
  console.log("PASS unsent legacy assignment keeps the recorded vehicle without inferring a pairing");
  await prisma.dispatchMessage.create({ data: {
    rideId: ride.id, adminId: actorId, dispatchRecipient: "DRIVER", status: "PENDING",
    toPhone: ride.driverPhone!, body: "Synthetic pending notification; never submitted to any provider.",
  } });
  await navigate("/admin/rides");
  await wait(`[...document.querySelectorAll("button.ride-row")].some(el=>el.textContent.includes(${JSON.stringify(`${marker}-Booking-1`)}))`);
  await evaluate(`[...document.querySelectorAll("button.ride-row")].find(el=>el.textContent.includes(${JSON.stringify(`${marker}-Booking-1`)})).click()`);
  await wait(`Boolean(document.querySelector("#dw-notifications-heading"))`);
  await button("Back");
  await wait(`Boolean(document.querySelector("#dw-assignment-heading"))`);
  assert.equal(await evaluate(`document.querySelectorAll(".dw-driver-select-grid select").length`), 0);
  assert.equal(await evaluate(`document.querySelector(".cvs-open").disabled`), true);
  assert.ok(await evaluate(`document.querySelector(".dw-assignment-summary").textContent.includes(${JSON.stringify(`${marker}-Vehicle-1`)})`));
  await screenshot("locked-legacy-assignment");
  console.log("PASS pending legacy assignment is read-only and displays the saved vehicle");
} catch (reason) {
  if (socket?.readyState === WebSocket.OPEN) {
    console.error("Browser diagnostic:", await evaluate(`JSON.stringify({width:innerWidth,viewportWidth:visualViewport?.width,dialogWidth:document.querySelector(".dw-dialog")?.getBoundingClientRect().width,alert:document.querySelector(".form-error,.cvs-error,.dw-alert")?.textContent})`));
  }
  throw reason;
} finally {
  // Capture IDs even when the browser fails immediately after a successful server write.
  const drivers = await prisma.chauffeur.findMany({ where: { name: { startsWith: marker } }, select: { id: true } });
  const vehicles = await prisma.fleetVehicle.findMany({ where: { name: { startsWith: marker } }, select: { id: true } });
  await prisma.inquiry.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.chauffeur.deleteMany({ where: { id: { in: [...driverIds, ...drivers.map(item => item.id)] } } });
  await prisma.fleetVehicle.deleteMany({ where: { id: { in: [...vehicleIds, ...vehicles.map(item => item.id)] } } });
  if (actorId) await prisma.adminUser.delete({ where: { id: actorId } });
  await prisma.$disconnect();
  socket?.close();
  browser.kill();
  await new Promise<void>(resolve => { if (browser.exitCode !== null) resolve(); else browser.once("exit", () => resolve()); });
  // Chromium subprocesses may finish their profile writes just after the parent exits.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
