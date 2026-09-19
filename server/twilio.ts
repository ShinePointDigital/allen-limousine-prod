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
  date_created?: string | null;
  date_sent?: string | null;
};

export class TwilioRequestError extends Error {
  constructor(message: string, readonly definitivelyRejected: boolean) {
    super(message);
  }
}

function normalizeTwilioPhone(value: string, label: "sender" | "recipient") {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length >= 11 && digits.length <= 15 ? `+${digits}` : "";
  if (!normalized) throw new TwilioRequestError(`The Twilio ${label} number must be a valid E.164 phone number.`, true);
  return normalized;
}

export function twilioPhonesEqual(left: string | null, right: string | null) {
  if (!left || !right) return false;
  try {
    return normalizeTwilioPhone(left, "recipient") === normalizeTwilioPhone(right, "recipient");
  } catch {
    return false;
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

async function twilioRequest(path: string, init?: RequestInit) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (accountSid || authToken) {
    if (!accountSid || !authToken) throw new TwilioRequestError("Set both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.", true);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`);
    return fetch(`https://api.twilio.com${path}`, { ...init, headers });
  }
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
  return connectors.proxy("twilio", path, {
    method: init?.method,
    headers,
    body: init?.body,
  });
}

async function getAccountSid() {
  if (process.env.TWILIO_ACCOUNT_SID) return process.env.TWILIO_ACCOUNT_SID;
  accountSidPromise ??= (async () => {
    const response = await twilioRequest("/2010-04-01/Accounts.json");
    const payload = await readTwilioResponse(response) as { accounts?: { sid?: string }[] };
    const sid = payload.accounts?.[0]?.sid;
    if (!sid) throw new Error("Twilio account SID is not available. Set TWILIO_ACCOUNT_SID.");
    return sid;
  })();
  return accountSidPromise;
}

function mapTwilioMessage(payload: TwilioMessage, accountSid: string) {
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

export async function sendSms(to: string, body: string) {
  const configuredFrom = process.env.TWILIO_FROM_NUMBER;
  if (!configuredFrom) throw new TwilioRequestError("SMS is not configured. Set TWILIO_FROM_NUMBER for the connected Twilio account.", true);
  const from = normalizeTwilioPhone(configuredFrom, "sender");
  const recipient = normalizeTwilioPhone(to, "recipient");
  let accountSid: string;
  try {
    accountSid = await getAccountSid();
  } catch (error) {
    if (error instanceof TwilioRequestError) throw error;
    throw new TwilioRequestError(error instanceof Error ? error.message : "The Twilio account could not be resolved.", true);
  }
  const params = new URLSearchParams({ To: recipient, From: from, Body: body });
  try {
    if (process.env.TWILIO_STATUS_CALLBACK_URL && process.env.TWILIO_AUTH_TOKEN) {
      params.set("StatusCallback", new URL(process.env.TWILIO_STATUS_CALLBACK_URL).toString());
    }
  } catch {
    throw new TwilioRequestError("TWILIO_STATUS_CALLBACK_URL must be a valid absolute URL.", true);
  }
  const response = await twilioRequest(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params },
  );
  const payload = await readTwilioResponse(response) as { sid?: string; status?: string };
  if (!payload.sid || !/^SM[0-9a-f]{32}$/i.test(payload.sid)) {
    throw new TwilioRequestError("Twilio returned success without a valid message SID.", false);
  }
  return { providerMessageId: payload.sid || null, providerStatus: payload.status || null };
}

export const sendDriverDispatchSms = sendSms;

export async function getDriverDispatchSms(providerMessageId: string) {
  if (!/^SM[0-9a-f]{32}$/i.test(providerMessageId)) throw new Error("Enter the Twilio message SID that begins with SM.");
  const accountSid = await getAccountSid();
  const response = await twilioRequest(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(providerMessageId)}.json`,
  );
  const payload = await readTwilioResponse(response) as TwilioMessage;
  return mapTwilioMessage(payload, accountSid);
}

export async function findDriverDispatchSms(to: string, body: string, attemptedAt: string) {
  const accountSid = await getAccountSid();
  const recipient = normalizeTwilioPhone(to, "recipient");
  const attemptedTime = new Date(attemptedAt).getTime();
  if (!Number.isFinite(attemptedTime)) throw new TwilioRequestError("The dispatch attempt has an invalid timestamp.", true);
  const attemptedDate = new Date(attemptedTime);
  const messages = new Map<string, TwilioMessage>();
  for (const offset of [-1, 0, 1]) {
    const day = new Date(Date.UTC(attemptedDate.getUTCFullYear(), attemptedDate.getUTCMonth(), attemptedDate.getUTCDate() + offset)).toISOString().slice(0, 10);
    const query = new URLSearchParams({ To: recipient, DateSent: day, PageSize: "1000" });
    let nextPath: string | null = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json?${query}`;
    let pageCount = 0;
    while (nextPath && pageCount < 20) {
      const response = await twilioRequest(nextPath);
      const payload = await readTwilioResponse(response) as TwilioError & { messages?: TwilioMessage[]; next_page_uri?: string | null };
      for (const message of payload.messages || []) {
        if (message.sid) messages.set(message.sid, message);
      }
      nextPath = payload.next_page_uri ? `${new URL(payload.next_page_uri, "https://api.twilio.com").pathname}${new URL(payload.next_page_uri, "https://api.twilio.com").search}` : null;
      pageCount += 1;
    }
    if (nextPath) throw new TwilioRequestError("Twilio returned too many message pages to reconcile safely. Enter the exact message SID.", false);
  }
  const matches = [...messages.values()].filter(message => {
    const messageTime = new Date(message.date_created || message.date_sent || "").getTime();
    return twilioPhonesEqual(message.to || null, recipient) && message.body === body && Number.isFinite(messageTime) && Math.abs(messageTime - attemptedTime) <= 30 * 60 * 1000;
  });
  if (!matches.length) return null;
  if (matches.length > 1) throw new TwilioRequestError("Twilio returned multiple matching messages. Enter the exact message SID.", false);
  return mapTwilioMessage(matches[0], accountSid);
}

export function classifyTwilioMessageStatus(status: string): "SENT" | "FAILED" | "PENDING" {
  const normalized = status.toLowerCase();
  if (["failed", "undelivered", "canceled"].includes(normalized)) return "FAILED";
  if (["accepted", "scheduled", "queued", "sending", "sent", "delivered", "read", "received"].includes(normalized)) return "SENT";
  return "PENDING";
}