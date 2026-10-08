import assert from "node:assert/strict";
import test from "node:test";
import { bookingHasSmsConsent, SMS_CONSENT_AUTHOR, SMS_CONSENT_DISCLOSURE, SMS_CONSENT_VERSION, smsConsentAuditBody } from "./sms-consent";

const phone = "+13125550123";
const note = (consented: boolean) => ({ body: smsConsentAuditBody(consented, phone), authorId: null, authorName: SMS_CONSENT_AUTHOR });

test("consent evidence preserves the selected preference, phone, disclosure version and public policy links", () => {
  const body = note(true).body;
  const record = JSON.parse(body.slice("SMS consent record: ".length));
  assert.equal(record.consented, true);
  assert.equal(record.phone, phone);
  assert.equal(record.version, SMS_CONSENT_VERSION);
  assert.equal(record.disclosure, SMS_CONSENT_DISCLOSURE);
  assert.equal(record.termsPath, "/terms#sms-program");
  assert.equal(record.privacyPath, "/privacy#sms-privacy");
});

test("unselected and legacy bookings do not authorize customer SMS", () => {
  assert.equal(bookingHasSmsConsent([note(false)], phone), false);
  assert.equal(bookingHasSmsConsent([], phone), false);
});

test("only genuine consent for the same phone permits booking SMS", () => {
  assert.equal(bookingHasSmsConsent([note(true)], phone), true);
  assert.equal(bookingHasSmsConsent([note(true)], "+13125550124"), false);
  assert.equal(bookingHasSmsConsent([{ ...note(true), authorId: "staff-user" }], phone), false);
  assert.equal(bookingHasSmsConsent([{ ...note(true), authorName: "Customer note" }], phone), false);
});

test("malformed audit text never grants consent", () => {
  assert.equal(bookingHasSmsConsent([{ ...note(true), body: "SMS consent record: invalid" }], phone), false);
});
