import crypto from "node:crypto";
import type { SmsConversation, SmsMessage } from "@prisma/client";
import { databaseConfigured, getInquiries, getRides, prisma } from "./store.js";
import { normalizeTwilioPhone, twilioPhonesEqual } from "./twilio.js";

const demoConversations = new Map<string, SmsConversation>();
const demoMessages = new Map<string, SmsMessage>();
const iso = (value: Date | null) => value?.toISOString() || null;
const mapMessage = (message: SmsMessage) => ({ ...message, createdAt: message.createdAt.toISOString() });

async function contactIdentities(phones: string[]) {
  const [customers, drivers] = databaseConfigured
    ? await Promise.all([
      prisma.inquiry.findMany({ where: { phone: { in: phones } }, select: { phone: true, fullName: true } }),
      prisma.ride.findMany({ where: { driverPhone: { in: phones } }, select: { driverPhone: true, driverName: true } }),
    ])
    : await Promise.all([getInquiries(), getRides()]);
  return new Map(phones.map(phone => {
    const customerNames = [...new Set(customers.filter(item => twilioPhonesEqual(item.phone, phone)).map(item => item.fullName))];
    const driverNames = [...new Set(drivers.filter(item => twilioPhonesEqual(item.driverPhone, phone)).map(item => item.driverName).filter(Boolean))];
    // A phone that matches both roles is not silently attached to either one.
    const contactType = customerNames.length && !driverNames.length ? "CUSTOMER" : driverNames.length && !customerNames.length ? "DRIVER" : "UNKNOWN";
    const names = contactType === "CUSTOMER" ? customerNames : contactType === "DRIVER" ? driverNames : [];
    return [phone, { contactType, contactName: names.length === 1 ? names[0] : null }] as const;
  }));
}

function mapConversation(conversation: SmsConversation, identity?: { contactType: string; contactName: string | null }) {
  return {
    id: conversation.id, phone: conversation.phone,
    contactType: identity?.contactType || "UNKNOWN", contactName: identity?.contactName || null,
    unreadCount: conversation.unreadCount, optedOutAt: iso(conversation.optedOutAt),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
  };
}

export async function listSmsConversations() {
  const records = databaseConfigured
    ? await prisma.smsConversation.findMany({ orderBy: { lastMessageAt: "desc" }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } })
    : [...demoConversations.values()].sort((a, b) => +b.lastMessageAt - +a.lastMessageAt).map(item => ({
      ...item, messages: [...demoMessages.values()].filter(message => message.conversationId === item.id).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 1),
    }));
  const identities = await contactIdentities(records.map(item => item.phone));
  return records.map(item => ({
    ...mapConversation(item, identities.get(item.phone)),
    lastMessage: item.messages[0] ? { body: item.messages[0].body, direction: item.messages[0].direction, status: item.messages[0].status } : null,
  }));
}

export async function getSmsThread(id: string) {
  const record = databaseConfigured ? await prisma.smsConversation.findUnique({ where: { id } }) : demoConversations.get(id);
  if (!record) return null;
  const messages = databaseConfigured
    ? await prisma.smsMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } })
    : [...demoMessages.values()].filter(item => item.conversationId === id).sort((a, b) => +a.createdAt - +b.createdAt);
  const identities = await contactIdentities([record.phone]);
  return { conversation: mapConversation(record, identities.get(record.phone)), messages: messages.map(mapMessage) };
}

export async function smsRecipientOptedOut(phone: string) {
  const canonical = normalizeTwilioPhone(phone, "recipient");
  const record = databaseConfigured ? await prisma.smsConversation.findUnique({ where: { phone: canonical }, select: { optedOutAt: true } }) : [...demoConversations.values()].find(item => item.phone === canonical);
  return Boolean(record?.optedOutAt);
}

export async function markSmsThreadRead(id: string) {
  if (databaseConfigured) return (await prisma.smsConversation.updateMany({ where: { id }, data: { unreadCount: 0 } })).count > 0;
  const record = demoConversations.get(id);
  if (!record) return false;
  record.unreadCount = 0;
  return true;
}

export async function recordInboundSms(data: { providerMessageId: string; fromPhone: string; toPhone: string; body: string; optOutType?: "STOP" | "START" | "HELP" }) {
  const now = new Date();
  const keyword = data.body.trim().toUpperCase();
  const stop = data.optOutType === "STOP" || /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/.test(keyword);
  const start = data.optOutType === "START" || /^(START|UNSTOP)$/.test(keyword);
  const optOutUpdate = stop ? { optedOutAt: now } : start ? { optedOutAt: null } : {};
  if (!databaseConfigured) {
    const duplicate = [...demoMessages.values()].find(message => message.providerMessageId === data.providerMessageId);
    if (duplicate) return { duplicate: true, conversationId: duplicate.conversationId };
    let conversation = [...demoConversations.values()].find(item => item.phone === data.fromPhone);
    if (!conversation) {
      conversation = { id: crypto.randomUUID(), phone: data.fromPhone, unreadCount: 0, optedOutAt: null, lastMessageAt: now, createdAt: now, updatedAt: now };
      demoConversations.set(conversation.id, conversation);
    }
    Object.assign(conversation, optOutUpdate, { unreadCount: conversation.unreadCount + 1, lastMessageAt: now, updatedAt: now });
    const message: SmsMessage = { id: crypto.randomUUID(), conversationId: conversation.id, direction: "INBOUND", providerMessageId: data.providerMessageId, fromPhone: data.fromPhone, toPhone: data.toPhone, body: data.body, status: "RECEIVED", providerStatus: "received", deliveryStatus: "received", errorMessage: null, adminId: null, adminName: null, createdAt: now };
    demoMessages.set(message.id, message);
    return { duplicate: false, conversationId: conversation.id };
  }
  try {
    return await prisma.$transaction(async tx => {
      const duplicate = await tx.smsMessage.findUnique({ where: { providerMessageId: data.providerMessageId } });
      if (duplicate) return { duplicate: true, conversationId: duplicate.conversationId };
      const conversation = await tx.smsConversation.upsert({
        where: { phone: data.fromPhone },
        create: { phone: data.fromPhone, unreadCount: 1, lastMessageAt: now, ...optOutUpdate },
        update: { unreadCount: { increment: 1 }, lastMessageAt: now, ...optOutUpdate },
      });
      await tx.smsMessage.create({ data: { conversationId: conversation.id, direction: "INBOUND", providerMessageId: data.providerMessageId, fromPhone: data.fromPhone, toPhone: data.toPhone, body: data.body, status: "RECEIVED", providerStatus: "received", deliveryStatus: "received", createdAt: now } });
      return { duplicate: false, conversationId: conversation.id };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      const duplicate = await prisma.smsMessage.findUnique({ where: { providerMessageId: data.providerMessageId } });
      if (duplicate) return { duplicate: true, conversationId: duplicate.conversationId };
    }
    throw error;
  }
}

export async function createSmsReplyAttempt(data: { conversationId: string; fromPhone: string; body: string; adminId: string; adminName: string }) {
  const now = new Date();
  const conversation = databaseConfigured ? await prisma.smsConversation.findUnique({ where: { id: data.conversationId } }) : demoConversations.get(data.conversationId);
  if (!conversation) return null;
  if (conversation.optedOutAt) throw new Error("SMS_OPTED_OUT");
  const pendingDispatch = databaseConfigured
    ? await prisma.dispatchMessage.findFirst({ where: { toPhone: conversation.phone, status: "PENDING" } })
    : (await getRides()).flatMap(ride => ride.dispatchMessages).find(message => message.status === "PENDING" && twilioPhonesEqual(message.toPhone, conversation.phone));
  if (pendingDispatch) throw new Error("PENDING_DRIVER_DISPATCH");
  const messages = databaseConfigured ? await prisma.smsMessage.findMany({ where: { conversationId: conversation.id, OR: [{ direction: "INBOUND" }, { status: "PENDING" }] }, select: { direction: true, status: true } }) : [...demoMessages.values()].filter(item => item.conversationId === conversation.id);
  if (!messages.some(message => message.direction === "INBOUND")) throw new Error("SMS_INBOUND_REQUIRED");
  if (messages.some(message => message.direction === "OUTBOUND" && message.status === "PENDING")) throw new Error("SMS_REPLY_PENDING");
  const record = { ...data, id: crypto.randomUUID(), toPhone: conversation.phone, direction: "OUTBOUND", status: "PENDING", providerMessageId: null, providerStatus: null, deliveryStatus: null, errorMessage: null, createdAt: now };
  if (!databaseConfigured) {
    demoMessages.set(record.id, record);
    conversation.lastMessageAt = now;
    return mapMessage(record);
  }
  try {
    const message = await prisma.$transaction(async tx => {
      const result = await tx.smsMessage.create({ data: record });
      await tx.smsConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
      return result;
    });
    return mapMessage(message);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new Error("SMS_REPLY_PENDING");
    throw error;
  }
}

export async function getSmsReplyAttempt(conversationId: string, id: string) {
  const message = databaseConfigured ? await prisma.smsMessage.findFirst({ where: { id, conversationId, direction: "OUTBOUND" } }) : demoMessages.get(id);
  return message?.conversationId === conversationId && message.direction === "OUTBOUND" ? mapMessage(message) : null;
}

export async function getSmsMessageByProviderId(providerMessageId: string) {
  const message = databaseConfigured ? await prisma.smsMessage.findUnique({ where: { providerMessageId } }) : [...demoMessages.values()].find(item => item.providerMessageId === providerMessageId);
  return message ? mapMessage(message) : null;
}

export async function finishSmsReplyAttempt(id: string, data: { status: "SENT" | "FAILED" | "PENDING"; providerMessageId?: string | null; providerStatus?: string | null; deliveryStatus?: string | null; errorMessage?: string | null }) {
  if (!databaseConfigured) {
    const message = demoMessages.get(id);
    if (!message) return null;
    if (data.providerMessageId && [...demoMessages.values()].some(item => item.id !== id && item.providerMessageId === data.providerMessageId)) throw new Error("PROVIDER_ID_ALREADY_BOUND");
    if (message.status === "PENDING") Object.assign(message, data);
    return mapMessage(message);
  }
  await prisma.smsMessage.updateMany({ where: { id, direction: "OUTBOUND", status: "PENDING" }, data });
  const message = await prisma.smsMessage.findUnique({ where: { id } });
  return message ? mapMessage(message) : null;
}

export async function updateSmsDeliveryStatus(providerMessageId: string, deliveryStatus: string, errorMessage?: string | null) {
  const message = databaseConfigured ? await prisma.smsMessage.findUnique({ where: { providerMessageId } }) : [...demoMessages.values()].find(item => item.providerMessageId === providerMessageId);
  if (!message || message.direction !== "OUTBOUND") return null;
  const rank: Record<string, number> = { accepted: 1, scheduled: 1, queued: 1, sending: 2, sent: 3, delivered: 4, failed: 4, undelivered: 4, canceled: 4, read: 5 };
  const current = rank[message.deliveryStatus || ""] || 0;
  const next = rank[deliveryStatus] || 0;
  if (current > next || (current === 4 && next === 4 && message.deliveryStatus !== deliveryStatus)) return mapMessage(message);
  const failed = ["failed", "undelivered", "canceled"].includes(deliveryStatus);
  const data = { providerStatus: deliveryStatus, deliveryStatus, status: failed ? "FAILED" : "SENT", errorMessage: failed ? errorMessage || `Twilio reported ${deliveryStatus}.` : null };
  if (!databaseConfigured) Object.assign(message, data);
  else await prisma.smsMessage.updateMany({ where: { id: message.id, deliveryStatus: message.deliveryStatus }, data });
  return mapMessage(databaseConfigured ? (await prisma.smsMessage.findUnique({ where: { id: message.id } }))! : message);
}
