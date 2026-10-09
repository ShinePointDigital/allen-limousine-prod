import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ReservationSmsConsent } from "./ReservationSmsConsent";

const render = (checked: boolean) => renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement(ReservationSmsConsent, { checked, onChange: () => {} })));

test("the SMS checkbox is optional and is not selected for an unchecked state", () => {
  const html = render(false);
  assert.ok(html.includes('role="group" aria-labelledby="sms-consent-heading"'));
  assert.ok(html.includes('id="sms-consent-heading" class="reservation-sms-consent-heading">SMS notifications'));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(!html.includes('checked=""'));
  assert.ok(!html.includes("required"));
  assert.ok(render(true).includes('checked=""'));
});

test("the consent step names the business, services, rates, opt-out, help and policy links", () => {
  const html = render(false);
  for (const text of ["Allan Limousine", "reservation confirmations", "Message frequency varies", "Message and data rates may apply", "STOP", "HELP", "not a condition of purchasing transportation"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes('href="/terms#sms-program"'));
  assert.ok(html.includes('href="/privacy#sms-privacy"'));
  assert.ok(html.includes('aria-describedby="sms-consent-disclosure"'));
});
