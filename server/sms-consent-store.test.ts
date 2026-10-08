import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { addInquiry, databaseConfigured, prisma } from "./store.js";
import { SMS_CONSENT_AUTHOR } from "../shared/sms-consent.js";

for (const consented of [false, true]) {
  test(`booking creation atomically records SMS consent=${consented} without a new database column`, async t => {
    const originalFindUnique = prisma.inquiry.findUnique;
    const originalTransaction = prisma.$transaction;
    t.after(() => {
      prisma.inquiry.findUnique = originalFindUnique;
      prisma.$transaction = originalTransaction;
    });
    const notes: any[] = [];
    let saved: any;
    const tx = {
      inquiry: {
        create: async ({ data }: any) => {
          assert.ok(!("smsConsent" in data), "Consent must not be passed to an unrecognized database column");
          saved = { ...data, id: "consent-test-booking", createdAt: new Date(), updatedAt: new Date() };
          return saved;
        },
        findUniqueOrThrow: async () => ({ ...saved, inquiryNotes: notes }),
      },
      inquiryNote: {
        create: async ({ data }: any) => {
          notes.push({ ...data, createdAt: new Date(), author: null });
          return notes.at(-1);
        },
      },
    };
    (prisma.inquiry as any).findUnique = async () => null;
    (prisma as any).$transaction = async (callback: any) => callback(tx);
    const result = await addInquiry({
      bookingRequestId: crypto.randomUUID(),
      fullName: "Consent Test",
      email: "consent-test@example.invalid",
      phone: "+13125550123",
      serviceType: "Point-to-Point",
      pickupAt: new Date(Date.now() + 60_000).toISOString(),
      pickup: "Test pickup",
      destination: "Test destination",
      passengers: 1,
      paymentStatus: "authorization_pending",
      smsConsent: consented,
    });
    assert.equal(result.inquiry.smsConsent, consented);
    assert.equal(result.inquiry.history.length, 1);
    assert.equal(result.inquiry.history[0].author, SMS_CONSENT_AUTHOR);
    assert.ok(result.inquiry.history[0].createdAt);
    if (databaseConfigured) {
      assert.equal(notes[0].authorId, null);
      assert.equal(notes[0].authorName, SMS_CONSENT_AUTHOR);
    }
  });
}
