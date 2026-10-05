import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { createAdminRecoveryRouter } from "./admin-recovery-routes.js";
import { issueAdminPasswordReset, completeAdminPasswordReset, RESET_COOLDOWN_MS } from "./admin-recovery.js";
import { assertResetEmailConfigured, sendAdminResetEmail } from "./admin-mail.js";

const testToken = "a".repeat(64);
const testEmail = "recovery@example.invalid";

test("Vercel requires a verified sender and its own email credentials", async () => {
  assert.throws(() => assertResetEmailConfigured({ VERCEL: "1", SENDGRID_FROM_EMAIL: testEmail }));
  assert.throws(() => assertResetEmailConfigured({ VERCEL: "1", SENDGRID_API_KEY: "test-only" }));
  assert.doesNotThrow(() => assertResetEmailConfigured({ VERCEL: "1", SENDGRID_FROM_EMAIL: testEmail, SENDGRID_API_KEY: "test-only" }));
  let calls = 0;
  const transport: typeof fetch = async (_url, options) => {
    calls++;
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.from.email, testEmail);
    assert.equal(payload.personalizations[0].to[0].email, testEmail);
    assert.ok(payload.content[0].value.includes("#token="));
    return new Response(null, { status: 202 });
  };
  await sendAdminResetEmail(testEmail, `https://example.invalid/admin/reset-password#token=${testToken}`, {
    VERCEL: "1", SENDGRID_FROM_EMAIL: testEmail, SENDGRID_API_KEY: "test-only",
  }, transport);
  assert.equal(calls, 1, "An empty 202 response must not cause a parse failure or duplicate send.");
  await assert.rejects(sendAdminResetEmail(testEmail, "https://example.invalid/admin/reset-password", {
    VERCEL: "1", SENDGRID_FROM_EMAIL: testEmail, SENDGRID_API_KEY: "test-only",
  }, async () => new Response(null, { status: 403 })));
});

test("recovery API preserves privacy, enforces authorization, and handles delivery failures", async () => {
  const app = express();
  app.use(express.json());
  let configured = true;
  let deliveryFails = false;
  let coolingDown = false;
  const sent: { email: string; url: string }[] = [];
  app.use(createAdminRecoveryRouter({
    admin: (req, res, next) => req.header("x-test-role") ? next() : res.status(401).json({ error: "Sign in required." }),
    superAdmin: (req, res, next) => req.header("x-test-role") === "SUPER_ADMIN" ? next() : res.status(403).json({ error: "Super-admin required." }),
    origin: () => "https://example.invalid",
    assertConfigured: () => { if (!configured) throw new Error("Not configured."); },
    issue: async email => email !== testEmail ? { kind: "unavailable" } : coolingDown ? { kind: "cooldown" } : { kind: "issued", email, token: testToken, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    complete: async (token, password) => token === testToken && password === "a-secure-new-password",
    send: async (email, url) => { if (deliveryFails) throw new Error("Simulated provider failure."); sent.push({ email, url }); },
    users: async () => [
      { id: "active", email: testEmail, name: "Test Admin", role: "SUPER_ADMIN", active: true, createdAt: new Date().toISOString() },
      { id: "disabled", email: "disabled@example.invalid", name: "Disabled Admin", role: "ADMIN", active: false, createdAt: new Date().toISOString() },
    ],
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body: unknown = {}, role?: string) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}) }, body: JSON.stringify(body),
  });
  try {
    const existing = await request("/api/admin/forgot-password", { email: testEmail });
    const unknown = await request("/api/admin/forgot-password", { email: "unknown@example.invalid" });
    assert.equal(existing.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await existing.json(), await unknown.json());
    assert.equal(sent.length, 1);
    assert.equal(new URL(sent[0].url).pathname, "/admin/reset-password");
    assert.equal(new URL(sent[0].url).search, "");
    assert.ok(sent[0].url.endsWith(`#token=${testToken}`));

    configured = false;
    assert.equal((await request("/api/admin/forgot-password", { email: testEmail })).status, 503);
    assert.equal((await request("/api/admin/forgot-password", { email: "unknown@example.invalid" })).status, 503);
    configured = true;
    assert.equal((await request("/api/admin/reset-password", { token: testToken, password: "short" })).status, 400);
    assert.equal((await request("/api/admin/reset-password", { token: "b".repeat(64), password: "a-secure-new-password" })).status, 400);
    const completed = await request("/api/admin/reset-password", { token: testToken, password: "a-secure-new-password" });
    assert.equal(completed.status, 200);
    assert.ok(completed.headers.get("set-cookie")?.includes("allan_session="));
    assert.equal(completed.headers.get("cache-control"), "no-store");

    assert.equal((await request("/api/admin/users/active/password-reset")).status, 401);
    assert.equal((await request("/api/admin/users/active/password-reset", {}, "ADMIN")).status, 403);
    assert.equal((await request("/api/admin/users/disabled/password-reset", {}, "SUPER_ADMIN")).status, 409);
    assert.equal((await request("/api/admin/users/missing/password-reset", {}, "SUPER_ADMIN")).status, 404);
    assert.equal((await request("/api/admin/users/active/password-reset", {}, "SUPER_ADMIN")).status, 202);
    coolingDown = true;
    assert.equal((await request("/api/admin/users/active/password-reset", {}, "SUPER_ADMIN")).status, 429);
    coolingDown = false; deliveryFails = true;
    assert.equal((await request("/api/admin/users/active/password-reset", {}, "SUPER_ADMIN")).status, 503);
    const failedPublicSend = await request("/api/admin/forgot-password", { email: testEmail });
    assert.equal(failedPublicSend.status, 202, "Public delivery failures must not expose account existence.");
    assert.equal("token" in await failedPublicSend.json(), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("database tokens are hashed, single-use, expiring, and revoke sessions atomically", {
  skip: process.env.RUN_RECOVERY_DB_TESTS !== "1",
}, async () => {
  const database = new PrismaClient();
  const email = `recovery-${crypto.randomUUID()}@example.invalid`;
  let userId: string | undefined;
  try {
    const user = await database.adminUser.create({ data: { email, name: "Recovery integration test", role: "SUPER_ADMIN", passwordHash: await bcrypt.hash("original-test-password", 12) } });
    userId = user.id;
    const issued = await issueAdminPasswordReset(email, database);
    assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw new Error("No test token issued.");
    const saved = await database.adminPasswordReset.findUniqueOrThrow({ where: { userId } });
    assert.notEqual(saved.tokenHash, issued.token);
    assert.equal((await issueAdminPasswordReset(email, database)).kind, "cooldown");
    assert.equal((await issueAdminPasswordReset("unknown@example.invalid", database)).kind, "unavailable");
    assert.equal(await completeAdminPasswordReset(issued.token, "short", database), false);
    await database.adminPasswordReset.update({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await completeAdminPasswordReset(issued.token, "a-secure-new-password", database), false);
    const replacement = await issueAdminPasswordReset(email, database, new Date(saved.createdAt.getTime() + RESET_COOLDOWN_MS + 1));
    if (replacement.kind !== "issued") throw new Error("No replacement token issued.");
    assert.equal(await completeAdminPasswordReset(issued.token, "a-secure-new-password", database), false);
    await database.adminSession.createMany({ data: [1, 2].map(() => ({ userId: user.id, tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 60_000) })) });
    const results = await Promise.all([
      completeAdminPasswordReset(replacement.token, "first-new-test-password", database),
      completeAdminPasswordReset(replacement.token, "second-new-test-password", database),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await database.adminSession.count({ where: { userId } }), 0);
    assert.equal(await completeAdminPasswordReset(replacement.token, "reuse-test-password", database), false);
    const updated = await database.adminUser.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(updated.role, "SUPER_ADMIN");
    assert.equal(await bcrypt.compare("original-test-password", updated.passwordHash), false);
    assert.equal(await bcrypt.compare(results[0] ? "first-new-test-password" : "second-new-test-password", updated.passwordHash), true);
    const beforeDisable = await issueAdminPasswordReset(email, database);
    if (beforeDisable.kind !== "issued") throw new Error("No disable test token issued.");
    await database.adminUser.update({ where: { id: userId }, data: { active: false } });
    assert.equal(await completeAdminPasswordReset(beforeDisable.token, "disabled-test-password", database), false);
    assert.equal((await issueAdminPasswordReset(email, database)).kind, "unavailable");
    assert.equal((await database.adminUser.findUniqueOrThrow({ where: { id: userId } })).active, false);
  } finally {
    if (userId) await database.adminUser.delete({ where: { id: userId } });
    await database.$disconnect();
  }
});