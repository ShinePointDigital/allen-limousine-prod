import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
const { databaseConfigured, prisma } = await import("./store.js");
const inbox = await import("./sms-inbox-store.js");

test("development database persists inbound messages once and prevents concurrent pending replies", { skip: !databaseConfigured }, async () => {
  const phone = `+1999${crypto.randomInt(1000000, 9999999)}`;
  const providerId = () => `SM${crypto.randomBytes(16).toString("hex")}`;
  const admin = await prisma.adminUser.create({ data: { email: `sms-${crypto.randomUUID()}@example.test`, name: "SMS database fixture", passwordHash: "test-fixture-not-a-login", role: "ADMIN", permissions: ["sms"] } });
  try {
    const data = { providerMessageId: providerId(), fromPhone: phone, toPhone: "+13125550999", body: "Database fixture" };
    await Promise.all([inbox.recordInboundSms(data), inbox.recordInboundSms(data)]);
    const conversation = await prisma.smsConversation.findUniqueOrThrow({ where: { phone } });
    assert.equal(conversation.unreadCount, 1);
    assert.equal(await prisma.smsMessage.count({ where: { conversationId: conversation.id } }), 1);
    const attempt = { conversationId: conversation.id, fromPhone: data.toPhone, body: "Reply fixture", adminId: admin.id, adminName: admin.name };
    const results = await Promise.allSettled([inbox.createSmsReplyAttempt(attempt), inbox.createSmsReplyAttempt(attempt)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await prisma.smsMessage.count({ where: { conversationId: conversation.id, status: "PENDING" } }), 1);
    const pending = await prisma.smsMessage.findFirstOrThrow({ where: { conversationId: conversation.id, status: "PENDING" } });
    await inbox.finishSmsReplyAttempt(pending.id, { status: "SENT", providerMessageId: providerId(), deliveryStatus: "sent" });
    const stop = { ...data, providerMessageId: providerId(), body: "STOP", optOutType: "STOP" as const };
    const start = { ...data, providerMessageId: providerId(), body: "START", optOutType: "START" as const };
    await inbox.recordInboundSms(stop);
    assert.equal(await inbox.smsRecipientOptedOut(phone), true);
    const stopped = await prisma.smsConversation.findUniqueOrThrow({ where: { phone } });
    assert.ok(stopped.optedOutAt);
    assert.equal((await inbox.recordInboundSms(stop)).duplicate, true);
    const duplicateStop = await prisma.smsConversation.findUniqueOrThrow({ where: { phone } });
    assert.equal(duplicateStop.optedOutAt!.getTime(), stopped.optedOutAt.getTime());
    assert.equal(duplicateStop.unreadCount, stopped.unreadCount);
    await assert.rejects(inbox.createSmsReplyAttempt(attempt), /SMS_OPTED_OUT/);
    await inbox.recordInboundSms(start);
    assert.equal(await inbox.smsRecipientOptedOut(phone), false);
    const restarted = await prisma.smsConversation.findUniqueOrThrow({ where: { phone } });
    assert.equal(restarted.optedOutAt, null);
    // A retried old STOP must not undo the more recent START.
    assert.equal((await inbox.recordInboundSms(stop)).duplicate, true);
    assert.equal((await inbox.recordInboundSms(start)).duplicate, true);
    const replayed = await prisma.smsConversation.findUniqueOrThrow({ where: { phone } });
    assert.equal(replayed.optedOutAt, null);
    assert.equal(replayed.unreadCount, restarted.unreadCount);
    assert.equal(await prisma.smsMessage.count({ where: { providerMessageId: { in: [stop.providerMessageId, start.providerMessageId] } } }), 2);
    await inbox.markSmsThreadRead(conversation.id);
    assert.equal((await inbox.getSmsThread(conversation.id))!.conversation.unreadCount, 0);
  } finally {
    await prisma.smsConversation.deleteMany({ where: { phone } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  }
});
