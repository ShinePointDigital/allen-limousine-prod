import { randomBytes } from "node:crypto";

export type SmokeResult = { label: string; ok: boolean; details: string[] };
type Probe = { label: string; path: string; status: number; kind: "html" | "json"; driver?: boolean; spa?: boolean; hint: string };

export function parseOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Supply a valid --origin URL, without credentials, a path, query or fragment."); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Origin must use HTTPS (HTTP is allowed only for loopback fixtures), without credentials, a path, query or fragment.");
  }
  return url.origin;
}

async function readBody(response: Response): Promise<string> {
  // Bound memory usage, and never print even public response bodies.
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("body-limit");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}

const directives = (value: string | null) => (value || "").toLowerCase().split(",").map(x => x.trim());
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** No app imports, credentials, cookies, real capabilities or write requests. */
export async function checkDriverRelease(input: string, request: typeof fetch = fetch): Promise<SmokeResult[]> {
  const origin = parseOrigin(input);
  // Random unsigned bytes, never issued or persisted. Valid shape exercises the
  // missing-hash lookup and deployed schema, unlike a malformed-token shortcut.
  const invalidToken = randomBytes(32).toString("hex");
  const probes: Probe[] = [
    { label: "Driver SPA HTML", path: `/driver/trip/${invalidToken}`, status: 200, kind: "html", driver: true, spa: true,
      hint: "Check the Vercel SPA fallback and /driver/trip/(.*) headers in vercel.json." },
    { label: "Invalid driver token API", path: `/api/driver/trips/${invalidToken}`, status: 404, kind: "json", driver: true,
      hint: "Check the /api/:path* rewrite, driver-trip router, and deployed driver-access schema. A 503 needs server/schema investigation, not a real token." },
    { label: "Unauthenticated admin session", path: "/api/admin/session", status: 401, kind: "json",
      hint: "Check API rewriting and the admin authentication guard; this request must remain unauthenticated." },
    { label: "Public content API", path: "/api/content", status: 200, kind: "json",
      hint: "Check API rewriting and the public content handler; an HTML 200 is a broken API fallback." },
    { label: "Homepage", path: "/", status: 200, kind: "html", spa: true, hint: "Check the Vercel build output and index.html fallback." },
    { label: "Admin login HTML", path: "/admin/login", status: 200, kind: "html", spa: true, hint: "Check the SPA fallback; do not sign in for this check." },
    { label: "Privacy HTML", path: "/privacy", status: 200, kind: "html", hint: "Check the privacy.html build output and explicit legal-page rewrite." },
    { label: "Terms HTML", path: "/terms", status: 200, kind: "html", hint: "Check the terms.html build output and explicit legal-page rewrite." },
  ];
  const results: SmokeResult[] = [];
  for (const probe of probes) {
    const details: string[] = [];
    const signal = AbortSignal.timeout(20_000);
    try {
      const response = await request(`${origin}${probe.path}`, {
        method: "GET", redirect: "manual", credentials: "omit", signal,
        headers: { Accept: probe.kind === "json" ? "application/json" : "text/html" },
      });
      if (response.status !== probe.status) details.push(`Expected HTTP ${probe.status}, received ${response.status}.`);
      if (response.status >= 300 && response.status < 400) details.push("Redirect refused. Use the canonical promoted origin and check route rewrites; redirect destinations are not logged.");
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (type !== (probe.kind === "json" ? "application/json" : "text/html")) details.push(`Expected ${probe.kind === "json" ? "application/json" : "text/html"} content type.`);
      if (probe.driver) {
        const cache = directives(response.headers.get("cache-control"));
        if (!cache.includes("no-store")) details.push("Missing Cache-Control: no-store.");
        if (cache.some(x => /^(public|s-maxage(?:\s*=|$))/.test(x))) details.push("Conflicting shared-cache directive on driver response.");
        if (response.headers.get("referrer-policy")?.trim().toLowerCase() !== "no-referrer") details.push("Expected Referrer-Policy: no-referrer.");
        const robots = directives(response.headers.get("x-robots-tag"));
        for (const directive of ["noindex", "nofollow"]) {
          if (!robots.includes(directive)) details.push(`Missing X-Robots-Tag: ${directive}.`);
        }
      }
      const body = await readBody(response);
      if (probe.kind === "json") {
        let value: unknown;
        try { value = JSON.parse(body); } catch { details.push("Response is not valid JSON (body withheld)."); }
        if (!object(value)) details.push("Expected a JSON object (body withheld).");
        else if (probe.status >= 400) {
          if (typeof value.error !== "string" || !value.error.trim()) details.push("Expected a JSON error message (body withheld).");
          if ("trip" in value || "user" in value) details.push("Unexpected trip or user data on an unauthorized response (body withheld).");
        } else if (!Array.isArray(value.services) || !Array.isArray(value.fleet) || !object(value.siteContent)) {
          details.push("Public response lacks the services, fleet or siteContent contract (body withheld).");
        }
      } else {
        if (!/<html[\s>]/i.test(body)) details.push("Response is not an HTML document (body withheld).");
        if (probe.spa && (!/<div\b[^>]*\bid=["']root["']/i.test(body) ||
            !/<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+["'])[^>]*>/i.test(body))) {
          details.push("Missing SPA root or module entry script; an HTML error page is not a passing route.");
        }
      }
    } catch {
      // Fetch errors can contain credential-bearing URLs or provider response data.
      details.push("GET failed, timed out, or exceeded the 2 MiB response limit. Check reachability, TLS and server health; error contents withheld.");
    }
    if (details.length) details.push(probe.hint);
    results.push({ label: probe.label, ok: !details.length, details });
  }
  return results;
}

export function formatSmokeResults(results: SmokeResult[]): string {
  return results.map(result => `${result.ok ? "PASS" : "FAIL"} ${result.label}${result.details.map(detail => `\n  ${detail}`).join("")}`).join("\n") +
    `\n${results.filter(result => result.ok).length}/${results.length} checks passed. GET only; no credentials, issued capabilities, SMS or payment operations.`;
}
