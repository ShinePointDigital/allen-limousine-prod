import assert from "node:assert/strict";
import test from "node:test";
import { applicationDatabaseUrl } from "./database-config.js";

const development = "postgresql://example:example@development.invalid/app";
const shared = "postgresql://example:example@production.invalid/app";

test("application uses the explicit shared connection", () => {
  assert.equal(applicationDatabaseUrl({ DATABASE_URL: development, SHARED_DATABASE_URL: shared }), shared);
});

test("Vercel can continue using its configured DATABASE_URL", () => {
  assert.equal(applicationDatabaseUrl({ DATABASE_URL: shared }), shared);
});

test("explicit test mode ignores the shared production override", () => {
  assert.equal(applicationDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: development, SHARED_DATABASE_URL: shared }), development);
});

test("direct Node test workers also ignore the shared override", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "Node test worker identification must be available");
  assert.equal(applicationDatabaseUrl({ NODE_TEST_CONTEXT: "child-v8", DATABASE_URL: development, SHARED_DATABASE_URL: shared }), development);
});

test("in-memory test mode remains available", () => {
  assert.equal(applicationDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: "", SHARED_DATABASE_URL: shared }), "");
});

test("tests reject an explicitly shared production connection", () => {
  assert.throws(() => applicationDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: shared, SHARED_DATABASE_URL: shared }), /Refusing to run database tests/);
});

test("a missing database is not replaced with a synthetic connection", () => {
  assert.equal(applicationDatabaseUrl({}), undefined);
});
