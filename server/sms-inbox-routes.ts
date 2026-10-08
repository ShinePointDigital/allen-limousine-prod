import express, { type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getDispatchAttemptByProviderMessageId } from "./store.js";
import { createSmsReplyAttempt, finishSmsReplyAttempt, getSmsMessageByProviderId, getSmsReplyAttempt, getSmsThread, listSmsConversations, markSmsThreadRead, recordInboundSms } from "./sms-inbox-store.js";
import { classifyTwilioMessageStatus, findDriverDispatchSms, getDriverDispatchSms, normalizeTwilioPhone, sendSms, twilioPhonesEqual, TwilioRequestError, validTwilioSignature } from "./twilio.js";

type Options = {
  inboundOnly?: boolean;
  admin: RequestHandler;
  publicOrigin: (request: Request) => string;
  sendReply?: typeof sendSms;
  getProviderMessage?: typeof getDriverDispatchSms;
  findProviderMessage?: typeof findDriverDispatchSms;
};

export function createSmsInboxRouter(options: Options) {
  const router = express.Router();
  const sendReply = options.sendReply || sendSms;
  const getProviderMessage = options.getProviderMessage || getDriverDispatchSms;
  const findProviderMessage = options.findProviderMessage || findDriverDispatchSms;
  const inboundLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false });
  const replyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many SMS reply requests. Please wait before sending another reply." } });
  router.use("/api/admin/sms", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  router.post("/api/webhooks/twilio/inbound", inboundLimiter, async (req, res) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const sender = process.env.TWILIO_FROM_NUMBER;
    if (!authToken || !sender) return res.status(503).json({ error: "Inbound SMS is not configured." });
    const callbackUrl = process.env.TWILIO_INBOUND_CALLBACK_URL || `${options.publicOrigin(req)}${req.originalUrl}`;
    if (!validTwilioSignature(authToken, callbackUrl, req.header("x-twilio-signature") || "", req.body || {})) {
      return res.status(401).json({ error: "Invalid Twilio inbound signature." });
    }
    const parsed = z.object({
      MessageSid: z.string().regex(/^SM[0-9a-f]{32}$/i),
      From: z.string(), To: z.string(), Body: z.string().max(1600),
      AccountSid: z.string().optional(),
      OptOutType: z.enum(["STOP", "START", "HELP"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid inbound SMS." });
    if (parsed.data.AccountSid && process.env.TWILIO_ACCOUNT_SID && parsed.data.AccountSid !== process.env.TWILIO_ACCOUNT_SID) return res.status(403).json({ error: "Unexpected Twilio account." });
    if (!twilioPhonesEqual(parsed.data.To, sender)) return res.status(403).json({ error: "This recipient is not the configured SMS sender." });
    try {
      await recordInboundSms({
        providerMessageId: parsed.data.MessageSid,
        fromPhone: normalizeTwilioPhone(parsed.data.From, "recipient"),
        toPhone: normalizeTwilioPhone(parsed.data.To, "sender"),
        body: parsed.data.Body, optOutType: parsed.data.OptOutType,
      });
      // Acknowledge receipt without sending an automatic text.
      return res.type("text/xml").status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      if (error instanceof TwilioRequestError) return res.status(400).json({ error: error.message });
      console.error("Unable to persist an inbound SMS.");
      return res.status(503).json({ error: "The incoming message could not be saved. Twilio should retry delivery." });
    }
  });

  if (options.inboundOnly) return router;

  router.get("/api/admin/sms/inbox", options.admin, async (_req, res) => {
    try { res.json({ conversations: await listSmsConversations() }); }
    catch { res.status(503).json({ error: "The SMS inbox is unavailable. Its database migration must be applied before use." }); }
  });
  router.get("/api/admin/sms/inbox/:id", options.admin, async (req, res) => {
    const thread = await getSmsThread(String(req.params.id));
    if (!thread) return res.status(404).json({ error: "SMS conversation not found." });
    res.json(thread);
  });
  router.post("/api/admin/sms/inbox/:id/read", options.admin, async (req, res) => {
    if (!await markSmsThreadRead(String(req.params.id))) return res.status(404).json({ error: "SMS conversation not found." });
    res.status(204).end();
  });
  router.post("/api/admin/sms/inbox/:id/messages", options.admin, replyLimiter, async (req, res) => {
    const parsed = z.object({ body: z.string().trim().min(1).max(1600) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a reply between 1 and 1,600 characters." });
    if (!process.env.TWILIO_FROM_NUMBER || !process.env.TWILIO_STATUS_CALLBACK_URL || !process.env.TWILIO_AUTH_TOKEN) {
      return res.status(503).json({ error: "Configure the SMS sender and signed delivery callbacks before replying." });
    }
    let attempt;
    try {
      attempt = await createSmsReplyAttempt({
        conversationId: String(req.params.id), body: parsed.data.body,
        fromPhone: normalizeTwilioPhone(process.env.TWILIO_FROM_NUMBER, "sender"),
        adminId: res.locals.user.id, adminName: res.locals.user.name,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const messages: Record<string, string> = {
        SMS_OPTED_OUT: "This recipient opted out. Replies are blocked until they text START.",
        SMS_REPLY_PENDING: "A prior reply is still pending. Reconcile it before sending another SMS.",
        PENDING_DRIVER_DISPATCH: "A driver dispatch to this number is still pending. Reconcile it in Rides & dispatch before replying.",
        SMS_INBOUND_REQUIRED: "Replies require an existing incoming message from this recipient.",
      };
      if (messages[code]) return res.status(409).json({ code, error: messages[code] });
      return res.status(503).json({ error: "The reply could not be saved. No SMS was sent." });
    }
    if (!attempt) return res.status(404).json({ error: "SMS conversation not found." });
    let result;
    try { result = await sendReply(attempt.toPhone, attempt.body); }
    catch (error) {
      const rejected = error instanceof TwilioRequestError && error.definitivelyRejected;
      const detail = error instanceof Error ? error.message : "Twilio could not confirm the SMS outcome.";
      let message;
      try { message = await finishSmsReplyAttempt(attempt.id, { status: rejected ? "FAILED" : "PENDING", errorMessage: detail }); } catch { /* Keep the durable pending reservation. */ }
      return res.status(502).json({
        status: message?.status || "PENDING", message,
        error: rejected && message?.status === "FAILED" ? detail : "Twilio may have accepted this reply. It remains pending; reconcile it before sending another SMS.",
      });
    }
    if (!result.providerMessageId) return res.status(502).json({ status: "PENDING", error: "Twilio did not return a message SID. The reply remains pending and must be reconciled." });
    try {
      const status = result.providerStatus && classifyTwilioMessageStatus(result.providerStatus) === "FAILED" ? "FAILED" : "SENT";
      const message = await finishSmsReplyAttempt(attempt.id, { status, providerMessageId: result.providerMessageId, providerStatus: result.providerStatus, deliveryStatus: result.providerStatus, errorMessage: status === "FAILED" ? `Twilio reported ${result.providerStatus}.` : null });
      res.status(201).json({ message });
    } catch {
      res.status(503).json({ status: "PENDING", providerMessageId: result.providerMessageId, error: "Twilio accepted this reply, but its saved record remains pending. Reconcile it before sending another SMS." });
    }
  });
  router.post("/api/admin/sms/inbox/:id/messages/:messageId/reconcile", options.admin, replyLimiter, async (req, res) => {
    const attempt = await getSmsReplyAttempt(String(req.params.id), String(req.params.messageId));
    if (!attempt) return res.status(404).json({ error: "SMS reply attempt not found." });
    if (attempt.status !== "PENDING") return res.status(409).json({ message: attempt, error: "This reply is no longer pending. Refresh the conversation." });
    const parsed = z.object({ providerMessageId: z.string().trim().regex(/^SM[0-9a-f]{32}$/i).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the Twilio message SID that begins with SM." });
    let provider;
    try {
      const sid = parsed.data.providerMessageId || attempt.providerMessageId;
      provider = sid ? await getProviderMessage(sid) : await findProviderMessage(attempt.toPhone, attempt.body, attempt.createdAt);
    } catch {
      return res.status(502).json({ status: "PENDING", error: "Twilio could not verify this reply. It remains pending; do not resend." });
    }
    if (!provider) return res.status(409).json({ status: "PENDING", error: "Twilio does not show a matching message yet. Its history may be delayed; the reply remains pending." });
    if (!twilioPhonesEqual(provider.toPhone, attempt.toPhone) || !twilioPhonesEqual(provider.fromPhone, attempt.fromPhone) || provider.body !== attempt.body) {
      return res.status(409).json({ status: "PENDING", error: "That Twilio message has a different sender, recipient, or body. The reply remains pending." });
    }
    const createdAt = provider.createdAt ? new Date(provider.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt) || Math.abs(createdAt - new Date(attempt.createdAt).getTime()) > 30 * 60 * 1000) return res.status(409).json({ status: "PENDING", error: "That Twilio message could not be matched to this attempt's time. The reply remains pending." });
    const [boundReply, boundDispatch] = await Promise.all([getSmsMessageByProviderId(provider.providerMessageId), getDispatchAttemptByProviderMessageId(provider.providerMessageId)]);
    if ((boundReply && boundReply.id !== attempt.id) || boundDispatch) return res.status(409).json({ status: "PENDING", error: "That Twilio SID is already attached to another message. The reply remains pending." });
    const status = classifyTwilioMessageStatus(provider.providerStatus);
    try {
      const message = await finishSmsReplyAttempt(attempt.id, {
        status, providerMessageId: provider.providerMessageId, providerStatus: provider.providerStatus,
        deliveryStatus: provider.providerStatus, errorMessage: status === "FAILED" ? provider.errorMessage || `Twilio reported ${provider.providerStatus}.` : null,
      });
      if (status === "PENDING") return res.status(409).json({ status, providerStatus: provider.providerStatus, message, error: "Twilio has not confirmed acceptance or failure yet. This reply remains pending." });
      res.json({ status, providerStatus: provider.providerStatus, message });
    } catch { res.status(409).json({ status: "PENDING", error: "The provider SID could not be safely attached. Refresh before trying again." }); }
  });
  return router;
}
