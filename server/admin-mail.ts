import { ReplitConnectors } from "@replit/connectors-sdk";
import { z } from "zod";

export function assertResetEmailConfigured(environment: NodeJS.ProcessEnv = process.env) {
  if (!z.email().safeParse(environment.SENDGRID_FROM_EMAIL?.trim()).success) {
    throw new Error("A verified SENDGRID_FROM_EMAIL is required.");
  }
  if (!environment.SENDGRID_API_KEY && (environment.VERCEL || !environment.REPL_ID)) {
    throw new Error("SENDGRID_API_KEY is required outside Replit.");
  }
}

export async function sendAdminResetEmail(to: string, resetUrl: string, environment: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  assertResetEmailConfigured(environment);
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: environment.SENDGRID_FROM_EMAIL!.trim(), name: "Allan Limousine" },
    subject: "Reset your Allan Limousine administrator password",
    content: [{
      type: "text/plain",
      value: `A password reset was requested for your Allan Limousine administrator account.\n\nChoose a new password using this single-use link:\n${resetUrl}\n\nThis link expires in 30 minutes. Completing the reset signs out all existing sessions.\n\nIf you did not request this, you can ignore this email. Your password has not changed.`,
    }],
  };
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  };
  const response = environment.SENDGRID_API_KEY
    ? await transport("https://api.sendgrid.com/v3/mail/send", {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${environment.SENDGRID_API_KEY}` },
    })
    : await new ReplitConnectors().proxy("sendgrid", "/v3/mail/send", options);
  // SendGrid accepts mail with an empty 202 body. Do not parse it or retry the send.
  if (response.status !== 202) throw new Error(`Reset email provider returned HTTP ${response.status}.`);
}