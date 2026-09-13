import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
let accountSidPromise: Promise<string> | undefined;

type TwilioError = { message?: string; code?: number | string; more_info?: string };
type TwilioMessage = TwilioError & {
  sid?: string;
  status?: string;
  account_sid?: string;
  to?: string;
  from?: string;
  body?: string;
  error_code?: number | string | null;
  error_message?: string | null;
};

export class TwilioRequestError extends Error {
  constructor(message: string, readonly definitivelyRejected: boolean) {
    super(message);
  }
}

async function readTwilioResponse(response: Response) {
  const text = await response.text();
  let payload: TwilioError & { sid?: string } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep the provider's status as the useful error when it did not return JSON.
  }
  if (!response.ok) {
    const detail = payload.message || text || `Twilio returned HTTP ${response.status}.`;
    throw new TwilioRequestError(payload.code ? `Twilio ${payload.code}: ${detail}` : detail, response.status >= 400 && response.status < 500);
  }
  return payload;
}

async function getAccountSid() {
  if (process.env.TWILIO_ACCOUNT_SID) return process.env.TWILIO_ACCOUNT_SID;
  accountSidPromise ??= (async () => {
    const response = await connectors.proxy("twilio", "/2010-04-01/Accounts.json");
    const payload = await readTwilioResponse(response) as { accounts?: { sid?: string }[] };
    const sid = payload.accounts?.[0]?.sid;
    if (!sid) throw new Error("Twilio account SID is not available. Set TWILIO_ACCOUNT_SID.");
    return sid;
  })();
  return accountSidPromise;
}

export async function sendDriverDispatchSms(to: string, body: string) {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new TwilioRequestError("SMS is not configured. Set TWILIO_FROM_NUMBER for the connected Twilio account.", true);
  let accountSid: string;
  try {
    accountSid = await getAccountSid();
  } catch (error) {
    if (error instanceof TwilioRequestError) throw error;
    throw new TwilioRequestError(error instanceof Error ? error.message : "The Twilio account could not be resolved.", true);
  }
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  try {
    if (process.env.TWILIO_STATUS_CALLBACK_URL && process.env.TWILIO_AUTH_TOKEN) {
      params.set("StatusCallback", new URL(process.env.TWILIO_STATUS_CALLBACK_URL).toString());
    }
  } catch {
    throw new TwilioRequestError("TWILIO_STATUS_CALLBACK_URL must be a valid absolute URL.", true);
  }
  const response = await connectors.proxy(
    "twilio",
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params },
  );
  const payload = await readTwilioResponse(response) as { sid?: string; status?: string };
  if (!payload.sid || !/^SM[0-9a-f]{32}$/i.test(payload.sid)) {
    throw new TwilioRequestError("Twilio returned success without a valid message SID.", false);
  }
  return { providerMessageId: payload.sid || null, providerStatus: payload.status || null };
}

export async function getDriverDispatchSms(providerMessageId: string) {
  if (!/^SM[0-9a-f]{32}$/i.test(providerMessageId)) throw new Error("Enter the Twilio message SID that begins with SM.");
  const accountSid = await getAccountSid();
  const response = await connectors.proxy(
    "twilio",
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(providerMessageId)}.json`,
  );
  const payload = await readTwilioResponse(response) as TwilioMessage;
  if (!payload.sid || !payload.status) throw new Error("Twilio did not return a usable message status.");
  return {
    providerMessageId: payload.sid,
    providerStatus: payload.status.toLowerCase(),
    accountSid: payload.account_sid || accountSid,
    toPhone: payload.to || null,
    fromPhone: payload.from || null,
    body: payload.body || null,
    errorCode: payload.error_code ? String(payload.error_code) : null,
    errorMessage: payload.error_message || null,
  };
}

export function classifyTwilioMessageStatus(status: string): "SENT" | "FAILED" | "PENDING" {
  const normalized = status.toLowerCase();
  if (["failed", "undelivered", "canceled"].includes(normalized)) return "FAILED";
  if (["accepted", "scheduled", "queued", "sending", "sent", "delivered", "read", "received"].includes(normalized)) return "SENT";
  return "PENDING";
}