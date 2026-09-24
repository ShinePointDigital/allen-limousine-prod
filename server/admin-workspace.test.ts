import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.ALLOW_IN_MEMORY_DEMO = "true";
process.env.ADMIN_EMAIL = "root@example.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "initial-demo-password";
process.env.SESSION_SECRET = "admin-workspace-test-session-secret";

const store = await import("./store.js");

test("demo adapter persists public profile, service creation, and admin session controls", async () => {
  const profile = {
    businessPhone: "+1 773 555 0101",
    contactEmail: "support@example.test",
    serviceArea: "Chicago · North Shore",
  };
  assert.deepEqual(await store.updateCompanyProfile(profile), profile);
  assert.deepEqual(await store.getCompanyProfile(), profile);
  assert.deepEqual((await store.getPublicContent()).companyProfile, profile);

  const service = await store.createService({
    slug: "test-admin-service",
    title: "Test Admin Service",
    eyebrow: "Test offering",
    description: "Created by the admin workspace test.",
    imageUrl: "https://example.test/service.jpg",
    active: true,
  });
  assert.equal((await store.updateService(service.id, { title: "Updated Admin Service", description: service.description, active: false }))?.title, "Updated Admin Service");
  assert.equal(await store.deleteService(service.id) !== null, true);

  const root = (await store.listAdmins()).find(user => user.email === "root@example.test");
  assert.ok(root);
  const firstLogin = await store.authenticate(root.email, "initial-demo-password");
  const secondLogin = await store.authenticate(root.email, "initial-demo-password");
  assert.ok(firstLogin && secondLogin);

  let sessions = await store.listAdminSessions(root.id, firstLogin.token);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter(session => session.isCurrent).length, 1);
  assert.equal(await store.revokeOtherAdminSessions(root.id, firstLogin.token), 1);
  sessions = await store.listAdminSessions(root.id, firstLogin.token);
  assert.equal(sessions.length, 1);
  assert.equal(await store.sessionUser(secondLogin.token), null);
  assert.equal((await store.sessionUser(firstLogin.token))?.id, root.id);

  const administrator = await store.createAdmin({
    name: "Demo Administrator",
    email: "admin@example.test",
    password: "temporary-password-123",
    role: "ADMIN",
  });
  assert.equal("passwordHash" in administrator, false);
  assert.equal((await store.authenticate(administrator.email, "temporary-password-123"))?.user.id, administrator.id);
  assert.equal(await store.updateAdmin(root.id, { role: "ADMIN" }), "LAST_SUPER_ADMIN");

  const secondSuperAdmin = await store.createAdmin({
    name: "Second Super Admin",
    email: "super@example.test",
    password: "another-temporary-password",
    role: "SUPER_ADMIN",
  });
  const demotedRoot = await store.updateAdmin(root.id, { role: "ADMIN" });
  assert.ok(demotedRoot && typeof demotedRoot === "object");
  assert.equal(demotedRoot.role, "ADMIN");
  assert.equal(await store.updateAdmin(secondSuperAdmin.id, { active: false }), "LAST_SUPER_ADMIN");
  const disabledAdministrator = await store.updateAdmin(administrator.id, { active: false });
  assert.ok(disabledAdministrator && typeof disabledAdministrator === "object");
  assert.equal(disabledAdministrator.active, false);
  assert.equal(await store.authenticate(administrator.email, "temporary-password-123"), null);
});