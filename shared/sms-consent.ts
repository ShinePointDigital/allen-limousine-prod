import { SMS_BRAND } from "./sms-program.js";
export const SMS_CONSENT_VERSION = "service-sms-v2";
const LEGACY_SMS_AGREEMENT = "I agree to receive service-related text messages, including automated texts, from Allan Limousine at the phone number I provided about reservation confirmations, pickup and ride-status updates, and chauffeur dispatch.";
export const SMS_CONSENT_AGREEMENT = `I agree to receive service-related text messages, including automated texts, from ${SMS_BRAND} at the phone number I provided about reservation confirmations, pickup and ride-status updates, and chauffeur dispatch.`;
export const SMS_CONSENT_DISCLOSURE = "Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is optional and is not a condition of purchasing transportation.";
export const SMS_CONSENT_AUTHOR = "Website SMS consent";

export function smsConsentAuditBody(consented: boolean, phone: string) {
  return `SMS consent record: ${JSON.stringify({
    type: "transactional_sms_consent",
    consented,
    phone,
    source: "website_booking_checkout",
    version: SMS_CONSENT_VERSION,
    agreement: SMS_CONSENT_AGREEMENT,
    disclosure: SMS_CONSENT_DISCLOSURE,
    termsPath: "/terms#sms-program",
    privacyPath: "/privacy#sms-privacy",
  })}`;
}

export function bookingHasSmsConsent(notes: { body: string; authorId?: string | null; authorName?: string | null }[], phone: string) {
  return notes.some(note => {
    if (note.authorId != null || note.authorName !== SMS_CONSENT_AUTHOR || !note.body.startsWith("SMS consent record: ")) return false;
    try {
      const record = JSON.parse(note.body.slice("SMS consent record: ".length));
      return record.type === "transactional_sms_consent" && record.consented === true &&
        record.phone === phone && record.source === "website_booking_checkout" &&
        ((record.version === SMS_CONSENT_VERSION && record.agreement === SMS_CONSENT_AGREEMENT) ||
         (record.version === "service-sms-v1" && record.agreement === LEGACY_SMS_AGREEMENT));
    } catch {
      return false;
    }
  });
}
