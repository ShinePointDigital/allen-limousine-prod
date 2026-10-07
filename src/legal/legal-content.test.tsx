import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LEGAL_BUSINESS, LEGAL_PHONE, LEGAL_PHONE_HREF, privacyDocument, termsDocument, type LegalDocument } from "./legal-content";

const render = (document: LegalDocument) => renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement("article", null, ...document.sections.map(section => createElement("section", { id: section.id, key: section.id }, section.content)))));

test("privacy explicitly protects mobile information and SMS opt-in data from third-party and affiliate marketing", () => {
  const html = render(privacyDocument);
  assert.ok(html.includes("Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes."));
  assert.ok(html.includes("SMS opt-in data and consent will not be shared with third parties or affiliates for marketing or promotional purposes."));
  assert.ok(html.includes("not for their own marketing"));
});

test("the service provider list omits Replit and Vercel without removing the other providers", () => {
  const section = privacyDocument.sections.find(section => section.id === "information-sharing")!;
  const html = render({ ...privacyDocument, sections: [section] });
  assert.ok(!html.includes("Replit"));
  assert.ok(!html.includes("Vercel"));
  for (const provider of ["Stripe", "Twilio", "Google Maps Platform", "Aviationstack", "SendGrid"]) assert.ok(html.includes(provider), provider);
});

test("SMS terms disclose variable frequency, message and data rates, STOP, HELP and support", () => {
  const html = render(termsDocument);
  for (const text of ["Message frequency varies", "Message and data rates may apply", "STOP", "HELP", "START", "not a condition of purchasing services", LEGAL_PHONE]) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`href="${LEGAL_PHONE_HREF}"`));
});

test("legal documents use the provided entity, Illinois jurisdiction and dedicated contact", () => {
  for (const document of [privacyDocument, termsDocument]) {
    const html = render(document);
    assert.ok(html.includes(LEGAL_BUSINESS));
    assert.ok(html.includes("Illinois"));
    assert.ok(html.includes(LEGAL_PHONE));
    assert.ok(!html.includes("hello@allanlimousine.com"));
    assert.ok(!html.includes("312 555 0188"));
    assert.equal(new Set(document.sections.map(section => section.id)).size, document.sections.length);
  }
});

test("links between the legal documents point to existing pages and section anchors", () => {
  const documents = { "/privacy": privacyDocument, "/terms": termsDocument };
  for (const document of Object.values(documents)) {
    for (const match of render(document).matchAll(/href="(\/[^"]+)"/g)) {
      const [path, anchor] = match[1].split("#");
      assert.ok(path in documents, match[1]);
      if (anchor) assert.ok(documents[path as keyof typeof documents].sections.some(section => section.id === anchor), match[1]);
    }
  }
});
