import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { checkDriverRelease, formatSmokeResults, parseOrigin } from "./driver-release-smoke.js";

const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const privateHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
function fixture(path: string): Response {
  const driver = path.startsWith("/api/driver/trips/");
  const admin = path === "/api/admin/session";
  const api = path.startsWith("/api/");
  return new Response(api ? JSON.stringify(driver || admin ? { error: "Unavailable fixture" } :
    { services: [], fleet: [], siteContent: {} }) : html, {
    status: driver ? 404 : admin ? 401 : 200,
    headers: { "content-type": api ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      ...(driver || path.startsWith("/driver/") ? privateHeaders : {}) },
  });
}
function mock(change?: (path: string, response: Response) => Response | Promise<Response>): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.credentials, "omit");
    assert.ok(options?.signal);
    const headers = new Headers(options?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    assert.equal(options?.body, undefined);
    if (url.pathname.startsWith("/driver/") || url.pathname.startsWith("/api/driver/")) {
      assert.match(url.pathname.split("/").at(-1)!, /^[a-f0-9]{64}$/);
    }
    const response = fixture(url.pathname);
    return change ? change(url.pathname, response) : response;
  };
}

test("all release routes pass with GET-only, anonymous synthetic probes", async () => {
  const paths: string[] = [];
  const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) => {
    paths.push(path); return response;
  }));
  assert.equal(results.length, 8);
  assert.ok(results.every(result => result.ok), formatSmokeResults(results));
  assert.deepEqual(paths.slice(2), ["/api/admin/session", "/api/content", "/", "/admin/login", "/privacy", "/terms"]);
  assert.equal(paths[0].split("/").at(-1), paths[1].split("/").at(-1));
  const report = formatSmokeResults(results);
  assert.ok(!report.includes(paths[0].split("/").at(-1)!));
});

test("origins cannot smuggle credentials, tokens, paths or remote HTTP", async () => {
  for (const origin of ["not a URL", "https://user:secret@fixture.invalid", "https://fixture.invalid/driver/trip/token",
    "https://fixture.invalid?token=secret", "https://fixture.invalid#secret", "http://fixture.invalid", "file:///tmp"]) {
    let calls = 0;
    await assert.rejects(checkDriverRelease(origin, async () => { calls++; return fixture("/"); }));
    assert.equal(calls, 0);
  }
  assert.equal(parseOrigin("https://fixture.invalid/"), "https://fixture.invalid");
  assert.equal(parseOrigin("http://127.0.0.1:5000"), "http://127.0.0.1:5000");
});

test("API-to-SPA rewrites and unrelated JSON cannot pass", async () => {
  for (const body of [html, "not-json", "[]", '{"ok":true}']) {
    const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) =>
      path === "/api/content" ? new Response(body, { headers: { "content-type": body === html ? "text/html" : "application/json" } }) : response));
    assert.equal(results.find(result => result.label === "Public content API")!.ok, false);
  }
});

test("driver HTML must be the SPA shell, not a branded error page", async () => {
  const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) =>
    path.startsWith("/driver/") ? new Response("<html><body>Error</body></html>", {
      headers: { ...privateHeaders, "content-type": "text/html" },
    }) : response));
  assert.equal(results[0].ok, false);
  assert.match(formatSmokeResults(results), /Missing SPA root or module entry/);
});

test("each driver confidentiality header is required on HTML and API", async () => {
  for (const prefix of ["/driver/", "/api/driver/"]) {
    for (const header of ["cache-control", "referrer-policy", "x-robots-tag"]) {
      const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) => {
        if (path.startsWith(prefix)) response.headers.delete(header);
        return response;
      }));
      assert.equal(results[prefix === "/driver/" ? 0 : 1].ok, false);
    }
  }
  const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) => {
    if (path.startsWith("/driver/")) response.headers.set("cache-control", "public, no-store, s-maxage=600");
    return response;
  }));
  assert.equal(results[0].ok, false);
});

test("wrong authorization statuses, error shapes, and redirects fail without leaking data", async () => {
  const sensitive = "PRIVATE-CUSTOMER-AND-CREDENTIAL-SENTINEL";
  const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) => {
    if (path.startsWith("/api/driver/")) return new Response(JSON.stringify({ trip: sensitive }), {
      status: 200, headers: { ...privateHeaders, "content-type": "application/json" },
    });
    if (path === "/api/admin/session") return new Response(JSON.stringify({ user: sensitive }), {
      status: 401, headers: { "content-type": "application/json", "set-cookie": sensitive },
    });
    if (path === "/admin/login") return new Response(sensitive, { status: 307, headers: { location: `https://${sensitive}.invalid` } });
    return response;
  }));
  assert.equal(results[1].ok, false);
  assert.equal(results[2].ok, false);
  assert.equal(results[5].ok, false);
  assert.ok(!formatSmokeResults(results).includes(sensitive));
  assert.match(formatSmokeResults(results), /Redirect refused/);
});

test("transport failures, oversized bodies and 503s fail actionably and remain redacted", async () => {
  const results = await checkDriverRelease("https://fixture.invalid", mock((path, response) => {
    if (path.startsWith("/driver/")) throw new Error("SECRET provider details");
    if (path.startsWith("/api/driver/")) return new Response('{"error":"SECRET database details"}', {
      status: 503, headers: { ...privateHeaders, "content-type": "application/json" },
    });
    if (path === "/privacy") return new Response("SECRET".repeat(400_000), { headers: { "content-type": "text/html" } });
    return response;
  }));
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, false);
  assert.equal(results[6].ok, false);
  assert.equal(results[7].ok, true, "Failures must not prevent remaining checks");
  const report = formatSmokeResults(results);
  assert.ok(!report.includes("SECRET"));
  assert.match(report, /deployed driver-access schema/);
  assert.match(report, /2 MiB/);
});

test("CLI uses real GET requests and exits nonzero on a broken release", async t => {
  const methods: string[] = [];
  let broken = false;
  const server = createServer(async (request, response) => {
    methods.push(request.method!);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    const result = fixture(request.url!);
    response.writeHead(broken && request.url === "/api/content" ? 503 : result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function run(args: string[]) {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/check-driver-release.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    return { code, output };
  }
  assert.equal((await run(["--origin", origin])).code, 0);
  broken = true;
  const failure = await run(["--origin", origin]);
  assert.equal(failure.code, 1);
  assert.match(failure.output, /FAIL Public content API/);
  const usage = await run([]);
  assert.equal(usage.code, 1);
  assert.match(usage.output, /Usage:/);
  const invalid = await run(["--origin", "https://user:SECRET@fixture.invalid"]);
  assert.equal(invalid.code, 1);
  assert.ok(!invalid.output.includes("SECRET"));
  assert.equal(methods.length, 16);
  assert.ok(methods.every(method => method === "GET"));
});
