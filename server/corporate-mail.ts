import { ReplitConnectors } from "@replit/connectors-sdk";
import { assertResetEmailConfigured } from "./admin-mail.js";
import { CORPORATE_BRAND } from "../shared/corporate.js";
import { z } from "zod";

export class CorporateEmailError extends Error {
  constructor(readonly definitive: boolean) { super("Corporate access email delivery could not be confirmed."); }
}
async function corporateSender() {
  if (process.env.SENDGRID_FROM_EMAIL) {
    assertResetEmailConfigured();
    return process.env.SENDGRID_FROM_EMAIL.trim();
  }
  if (!process.env.REPL_ID || process.env.VERCEL) throw new Error("Configure a verified SENDGRID_FROM_EMAIL and SendGrid credentials before approving corporate accounts.");
  const response = await new ReplitConnectors().proxy("sendgrid", "/v3/verified_senders");
  if (!response.ok) throw new Error("The verified corporate email sender could not be confirmed.");
  const data = await response.json() as { results?: { verified: boolean; from_email: string }[] };
  const senders = (data.results || []).filter(s => s.verified && z.email().safeParse(s.from_email).success);
  if (senders.length !== 1) throw new Error("Select a verified SENDGRID_FROM_EMAIL before approving corporate accounts.");
  return senders[0].from_email;
}
export async function assertCorporateEmailConfigured() { await corporateSender(); }
export async function sendCorporateAccessEmail(to: string, username: string, password: string | null, loginUrl: string) {
  const sender = await corporateSender();
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: sender, name: CORPORATE_BRAND },
    subject: "Your Allan Limousine corporate account is approved",
    content: [{ type: "text/plain", value: `${CORPORATE_BRAND}\n\nYour corporate transportation account has been approved.\n\nSign in: ${loginUrl}\nUsername: ${username}\n${password ? `Temporary password: ${password}\n\nThis temporary password expires in 24 hours. You must replace it before booking rides or managing billing. Never forward this email.` : "Use your existing customer account password. Your password has not been changed."}\n\nEach completed ride is billed separately to your authorized company payment method. PO and cost-center references are required for every booking.` }],
  };
  const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) };
  const response = process.env.SENDGRID_API_KEY
    ? await fetch("https://api.sendgrid.com/v3/mail/send", { ...options, headers: { ...options.headers, Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` } })
    : await new ReplitConnectors().proxy("sendgrid", "/v3/mail/send", options);
  if (response.status !== 202) throw new CorporateEmailError(response.status >= 400 && response.status < 500);
}
