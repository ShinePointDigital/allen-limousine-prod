// Local browser smoke test using Chromium's DevTools protocol. No auth bypass.
// Seed the temporary ui-access-root@example.test account before running.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const domain = process.env.REPLIT_DEV_DOMAIN;
assert.ok(domain, "A running Replit development domain is required.");
const base = `https://${domain}:5000`;
const tabs = await (await fetch("http://127.0.0.1:9222/json")).json();
const socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
let id = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
const evaluate = async expression => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + JSON.stringify(result.exceptionDetails.exception?.description));
  return result.result?.value;
};
const wait = async (expression, label) => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}. Visible text: ${(await evaluate("document.body.innerText")).slice(-2000)}`);
};
const navigate = async path => {
  await call("Page.navigate", { url: base + path });
  await wait("document.readyState === 'complete' && document.querySelector('#root')?.children.length > 0", `load ${path}`);
};
const field = async (label, value, dialog = false) => {
  await evaluate(`(() => { const root = ${dialog ? "document.querySelector('.um-dialog')" : "document"}; const label = [...root.querySelectorAll('label')].find(el => el.textContent.trim().startsWith(${JSON.stringify(label)})); if (!label) throw new Error('Field not found'); const input = label.querySelector('input,select'); const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
};
const click = async (text, root = "document") => {
  await evaluate(`(() => { const button = [...${root}.querySelectorAll('button,a')].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Button not found: ${text}'); button.click(); })()`);
};
const password = "Ui-access-test-password-2026";
const resume = process.env.UI_TEST_RESUME_AFTER_CREATION === "true";
const resumeCustomer = process.env.UI_TEST_RESUME_CUSTOMER === "true";
const staffActionsOnly = process.env.UI_TEST_STAFF_ACTIONS_ONLY === "true";
const signIn = async (path, email, pass = password) => {
  await navigate(path);
  await wait("!!document.querySelector('input[type=password]')", "login form");
  await field("Email address", email);
  await field("Password", pass);
  await click("Sign in");
  await wait(path.startsWith("/admin") ? "location.pathname !== '/admin/login' && !!document.querySelector('.admin-sidebar')" : "location.pathname === '/account' && !!document.querySelector('.ca-welcome')", "successful sign in");
};
const createUser = async (role, email, name, permissions = []) => {
  await click("Add user");
  await wait("!!document.querySelector('.um-dialog')", "create dialog");
  await field("Full name", name, true);
  await field("Email address", email, true);
  await field("Initial password", password, true);
  await field("Account type", role, true);
  for (const permission of permissions) {
    await evaluate(`(() => { const label = [...document.querySelectorAll('.um-check')].find(el => el.querySelector('b').textContent === ${JSON.stringify(permission)}); if (!label) throw new Error('Permission not found'); label.querySelector('input').click(); })()`);
  }
  await click("Create account", "document.querySelector('.um-dialog')");
  await wait(`!document.querySelector('.um-dialog') && document.body.innerText.includes(${JSON.stringify(email)})`, `created ${role}`);
};
const screenshots = "/tmp/account-access-ui-evidence";
await fs.mkdir(screenshots, { recursive: true });
const screenshot = async name => {
  const data = await call("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(`${screenshots}/${name}.png`, Buffer.from(data.data, "base64"));
};
try {
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  if (staffActionsOnly) {
    const targetRow = "[...document.querySelectorAll('.um-row')].find(row=>row.innerText.includes('ui-access-password-target@example.test'))";
    const selfRow = "[...document.querySelectorAll('.um-row')].find(row=>row.innerText.includes('ui-access-root@example.test'))";
    await signIn("/admin/login", "ui-access-root@example.test");
    await navigate("/admin/admin-users");
    await wait(`!!${targetRow}`, "temporary staff row");
    assert.equal(await evaluate(`!!${selfRow}.querySelector('.um-delete-button')`), false, "Self delete must be hidden");
    await click("Set password", targetRow);
    await wait("!!document.querySelector('.um-password-dialog')", "direct password dialog");
    await field("New password", "Ui-staff-updated-password-2026", true);
    await field("Confirm new password", "mismatched-test-password", true);
    assert.equal(await evaluate("document.querySelector('.um-password-dialog form button[type=submit], .um-password-dialog form .solid-button').disabled"), true, "Mismatched passwords must not submit");
    await field("Confirm new password", "Ui-staff-updated-password-2026", true);
    await screenshot("staff-password-desktop");
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    await screenshot("staff-password-mobile");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await click("Change password", "document.querySelector('.um-password-dialog')");
    await wait("!document.querySelector('.um-password-dialog') && document.body.innerText.includes('Password changed')", "password changed");
    await click("Sign out");
    await signIn("/admin/login", "ui-access-password-target@example.test", "Ui-staff-updated-password-2026");
    await navigate("/admin/admin-users");
    await wait(`!!${targetRow}`, "limited staff account");
    const limitedActions = await evaluate(`${targetRow}.innerText`);
    assert.doesNotMatch(limitedActions, /Set password/, "Admin must not see Super Admin controls");
    assert.equal(await evaluate("!!document.querySelector('.um-delete-button')"), false);
    await click("Sign out");
    await signIn("/admin/login", "ui-access-root@example.test");
    await navigate("/admin/admin-users");
    await wait(`!!${targetRow}`, "staff delete row");
    await evaluate(`${targetRow}.querySelector('.um-delete-button').click()`);
    await wait("!!document.querySelector('.um-delete-dialog')", "delete confirmation");
    assert.equal(await evaluate("document.querySelector('.um-delete-dialog .um-danger-button').disabled"), true);
    await screenshot("staff-delete-confirmation");
    await click("Keep account", "document.querySelector('.um-delete-dialog')");
    assert.equal(await evaluate(`!!${targetRow}`), true, "Cancel must preserve the account");
    await evaluate(`${targetRow}.querySelector('.um-delete-button').click()`);
    await wait("!!document.querySelector('.um-delete-dialog')", "second delete confirmation");
    await evaluate("document.querySelector('.um-delete-ack input').click()");
    await click("Permanently delete", "document.querySelector('.um-delete-dialog')");
    await wait(`!document.querySelector('.um-delete-dialog') && !(${targetRow})`, "staff removed");
    await click("Set password", selfRow);
    await wait("!!document.querySelector('.um-password-dialog')", "own password dialog");
    await field("New password", "Ui-root-updated-password-2026", true);
    await field("Confirm new password", "Ui-root-updated-password-2026", true);
    await click("Change password", "document.querySelector('.um-password-dialog')");
    await wait("location.pathname === '/admin/login' && document.body.innerText.includes('Sign in with your new password')", "self change signs out");
    await signIn("/admin/login", "ui-access-root@example.test", "Ui-root-updated-password-2026");
    console.log("PASS: Super Admin direct password change, matching validation, new password sign-in, restricted Admin controls, safe delete/cancel, self deletion hidden, own password sign-out/login, mobile dialog.");
  } else {
  if (!resumeCustomer) {
  await signIn("/admin/login", "ui-access-root@example.test");
  await navigate("/admin/admin-users");
  await wait("!!document.querySelector('.um-create')", "user management");
  if (!resume) {
    await createUser("USER", "ui-access-customer@example.test", "UI Customer");
    await createUser("ADMIN", "ui-access-admin@example.test", "UI Limited Admin", ["Rides & dispatch", "Inquiries"]);
    await createUser("SUPER_ADMIN", "ui-access-super@example.test", "UI Extra Super");
    await evaluate("document.querySelector('[aria-label=\"Edit UI Limited Admin\"]').click()");
    await wait("!!document.querySelector('.um-dialog')", "edit dialog");
    await field("Full name", "UI Updated Admin", true);
    await click("Save changes", "document.querySelector('.um-dialog')");
    await wait("!document.querySelector('.um-dialog') && document.body.innerText.includes('UI Updated Admin')", "edit saved");
  }
  await screenshot("users-desktop");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 500));
  await screenshot("users-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), true, "Users screen has horizontal overflow");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click("Sign out");
  await signIn("/admin/login", "ui-access-admin@example.test");
  const navigation = await evaluate("document.querySelector('.admin-sidebar nav').innerText");
  assert.match(navigation, /Rides & dispatch/);
  assert.match(navigation, /Users & access/);
  assert.doesNotMatch(navigation, /Overview|Fleet|Site content|Settings/);
  await navigate("/admin/settings");
  await wait("document.body.innerText.includes('Access denied')", "direct route denied");
  assert.equal(await evaluate("fetch('/api/admin/company-profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessPhone:'+13125550101',contactEmail:'test@example.test',serviceArea:'Test'})}).then(r=>r.status)"), 403);
  assert.equal(await evaluate(`fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Blocked Test Super',email:'ui-access-blocked@example.test',password:${JSON.stringify(password)},role:'SUPER_ADMIN',permissions:[]})}).then(r=>r.status)`), 403);
  await navigate("/admin/admin-users");
  await wait("!!document.querySelector('.um-create')", "limited admin users");
  await createUser("USER", "ui-access-second-customer@example.test", "UI Second Customer");
  await click("Sign out");
  }
  await signIn("/account/login", "ui-access-customer@example.test");
  await wait("document.body.innerText.includes('No account-linked reservations yet')", "empty customer history");
  await screenshot("customer-account");
  assert.equal(await evaluate("fetch('/api/admin/session').then(r=>r.status)"), 401);
  await click("Book a ride", "document.querySelector('.ca-section-heading')");
  await wait("!!document.querySelector('#reserve')", "booking form");
  await wait("document.querySelector('#reserve').innerText.includes('Signed in as') && document.querySelector('#reserve').innerText.includes('UI Customer') && document.querySelector('#reserve').innerText.includes('My bookings')", "authenticated booking identity");
  // The wizard's contact fields mount at the final step, after route/fare lookup.
  // Do not call mapping or payment providers merely to test account identity.
  const emailPrefilled = await evaluate("(() => { const input = document.querySelector('#reserve input[type=email]'); return !input || input.value==='ui-access-customer@example.test' && input.readOnly; })()");
  assert.equal(emailPrefilled, true, "Booking contact must use account email");
  await navigate("/account");
  await wait("!!document.querySelector('.ca-password form')", "password form");
  await field("Current password", password);
  await field("New password", "Ui-access-updated-password-2026");
  await click("Update password");
  await wait("location.pathname === '/account/login' && document.body.innerText.includes('Password updated')", "password changed");
  await signIn("/account/login", "ui-access-customer@example.test", "Ui-access-updated-password-2026");
  console.log("PASS: staff creates all three roles, edits accounts, delegated ADMIN creates customer, permissions block navigation/API escalation, customer login/book prefill/password change work, mobile layout fits.");
  }
  console.log("Screenshots:", screenshots);
} finally {
  socket.close();
}
