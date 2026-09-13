import Stripe from "stripe";

type StripeCredentials = {
  secretKey: string;
  publishableKey: string;
  webhookSecret?: string;
};

async function connectorCredentials(): Promise<StripeCredentials | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !token) return null;
  const response = await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`, {
    headers: { Accept: "application/json", X_REPLIT_TOKEN: token },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { items?: Array<{ settings?: Record<string, string> }> };
  const settings = data.items?.[0]?.settings;
  const secretKey = settings?.secret_key;
  const publishableKey = settings?.publishable_key;
  return secretKey && publishableKey ? { secretKey, publishableKey, webhookSecret: settings?.webhook_secret } : null;
}

export async function getStripeCredentials(): Promise<StripeCredentials> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (secretKey && publishableKey) return { secretKey, publishableKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
  const connected = await connectorCredentials();
  if (connected) return connected;
  throw new Error("Stripe is not configured yet.");
}

export async function getStripeClient() {
  const credentials = await getStripeCredentials();
  return new Stripe(credentials.secretKey);
}

export async function getStripePublicConfig() {
  try {
    const { publishableKey } = await getStripeCredentials();
    return { configured: true as const, publishableKey };
  } catch {
    return { configured: false as const, publishableKey: null };
  }
}

export async function getStripeWebhookSecret() {
  const credentials = await getStripeCredentials();
  if (!credentials.webhookSecret) throw new Error("Stripe webhook signing is not configured.");
  return credentials.webhookSecret;
}