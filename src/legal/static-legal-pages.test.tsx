import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderStaticLegalPage, staticLegalDocuments, staticLegalPath } from "./static-legal-pages";

const css = readFileSync(new URL("./legal-page.css", import.meta.url), "utf8");

test("both legal pages include complete policy content without JavaScript", () => {
  for (const pathname of ["/privacy", "/terms"] as const) {
    const html = renderStaticLegalPage(pathname, css);
    const document = staticLegalDocuments[pathname];
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes(`<title>${document.title} | Allan Limousine</title>`));
    assert.ok(html.includes(document.introduction));
    assert.ok(html.includes("Allen Express, LLC"));
    assert.ok(html.includes("312-899-6718"));
    assert.ok(html.includes(`href="https://allanlimousine.com${pathname}"`));
    for (const section of document.sections) {
      assert.ok(html.includes(`id="${section.id}"`), section.id);
      assert.ok(html.includes(`href="#${section.id}"`), section.id);
    }
    assert.ok(html.includes('href="/privacy"'));
    assert.ok(html.includes('href="/terms"'));
    assert.ok(html.includes('href="/#reserve"'));
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!html.includes('<div id="root"></div>'));
    assert.ok(html.includes("font-style: normal !important"));
  }
});

test("static documents preserve approved messaging disclosures and updated dates", () => {
  const privacy = renderStaticLegalPage("/privacy", css);
  const terms = renderStaticLegalPage("/terms", css);
  assert.ok(privacy.includes("Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes."));
  assert.ok(privacy.includes("SMS opt-in data and consent will not be shared with third parties or affiliates for marketing or promotional purposes."));
  for (const text of ["Message frequency varies", "Message and data rates may apply", "STOP", "HELP"]) {
    assert.ok(terms.includes(text), text);
  }
  assert.match(privacy, /datetime="2026-10-06"/i);
  assert.match(terms, /datetime="2026-10-08"/i);
});

test("only intended legal routes select a static document", () => {
  for (const pathname of ["/privacy", "/privacy/", "/privacy.html"]) assert.equal(staticLegalPath(pathname), "/privacy");
  for (const pathname of ["/terms", "/terms/", "/terms.html"]) assert.equal(staticLegalPath(pathname), "/terms");
  for (const pathname of ["/", "/admin", "/api/content", "/privacy/other", "/terms-malicious"]) {
    assert.equal(staticLegalPath(pathname), null);
  }
});

test("Vercel legal rewrites precede the SPA fallback and remain database independent", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const fallbackIndex = config.rewrites.findIndex((rewrite: { source: string }) => rewrite.source === "/:path*");
  for (const path of ["/privacy", "/terms"]) {
    const index = config.rewrites.findIndex((rewrite: { source: string }) => rewrite.source === path);
    assert.ok(index >= 0 && index < fallbackIndex);
    assert.equal(config.rewrites[index].destination, `${path}.html`);
  }
});
