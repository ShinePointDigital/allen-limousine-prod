import express, { type RequestHandler, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { completeAdminPasswordReset, issueAdminPasswordReset } from "./admin-recovery.js";
import { assertResetEmailConfigured, sendAdminResetEmail } from "./admin-mail.js";
import { databaseConfigured, listAdmins } from "./store.js";

const genericResponse = { message: "If an active administrator account exists for that email, a reset link will be emailed. Please check your inbox and spam folder." };

export function createAdminRecoveryRouter(options: {
  admin: RequestHandler;
  superAdmin: RequestHandler;
  origin: (req: Request) => string;
  issue?: typeof issueAdminPasswordReset;
  complete?: typeof completeAdminPasswordReset;
  send?: typeof sendAdminResetEmail;
  assertConfigured?: () => void;
  users?: typeof listAdmins;
}) {
  const router = express.Router();
  const issue = options.issue || issueAdminPasswordReset;
  const complete = options.complete || completeAdminPasswordReset;
  const send = options.send || sendAdminResetEmail;
  const configured = options.assertConfigured || (() => {
    if (!databaseConfigured) throw new Error("Password recovery requires persistent account storage.");
    assertResetEmailConfigured();
  });
  const requestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many reset requests. Please try again later." } });
  const completionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many reset attempts. Please try again later." } });
  const resetUrl = (origin: string, token: string) => {
    const url = new URL("/admin/reset-password", origin);
    // Fragments do not reach server access logs or Referer headers.
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  };

  router.post("/api/admin/forgot-password", requestLimiter, async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
    let origin: string;
    try { configured(); origin = options.origin(req); }
    catch { return res.status(503).json({ error: "Password recovery email is not configured. Please contact an existing super-admin." }); }
    const result = await issue(parsed.data.email);
    if (result.kind === "issued") {
      try { await send(result.email, resetUrl(origin, result.token)); }
      catch {
        // Preserve account privacy and never log reset tokens, URLs, or credentials.
        console.error("Admin recovery email was not confirmed accepted; check the email provider configuration.");
      }
    }
    res.set("Cache-Control", "no-store").status(202).json(genericResponse);
  });

  router.post("/api/admin/reset-password", completionLimiter, async (req, res) => {
    const parsed = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(12).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Use a valid reset link and a password of 12–200 characters." });
    if (!await complete(parsed.data.token, parsed.data.password)) return res.status(400).json({ error: "This reset link is invalid, expired, or already used. Request a new link." });
    res.clearCookie("allan_session");
    res.set("Cache-Control", "no-store").json({ message: "Password updated. All previous sessions have been signed out. Sign in with your new password." });
  });

  router.post("/api/admin/users/:id/password-reset", options.admin, options.superAdmin, requestLimiter, async (req, res) => {
    const target = (await (options.users || listAdmins)()).find(user => user.id === String(req.params.id));
    if (!target) return res.status(404).json({ error: "Administrator not found." });
    if (!target.active) return res.status(409).json({ error: "Disabled accounts cannot reset their password." });
    let origin: string;
    try { configured(); origin = options.origin(req); }
    catch { return res.status(503).json({ error: "Configure the verified reset-email sender and email credentials before sending links." }); }
    const result = await issue(target.email);
    if (result.kind === "cooldown") return res.status(429).json({ error: "A reset link was requested recently. Wait one minute before sending another." });
    if (result.kind !== "issued") return res.status(409).json({ error: "This account is not available for password recovery." });
    try { await send(result.email, resetUrl(origin, result.token)); }
    catch { return res.status(503).json({ error: "Email acceptance could not be confirmed. The account password is unchanged. Check SendGrid or retry after one minute." }); }
    res.status(202).json({ message: `SendGrid accepted the reset email for ${target.email}. The link expires in 30 minutes.` });
  });
  return router;
}