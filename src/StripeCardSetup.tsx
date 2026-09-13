import { useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Check, CreditCard, LockKeyhole } from "lucide-react";

export type SavedPayment = {
  customerId: string;
  paymentMethodId: string;
  cardBrand: string;
  cardLast4: string;
  capability: string;
};

const api = async (url: string, body?: unknown) => {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Secure payment setup failed.");
  return data;
};

function SetupForm({ clientSecret, setupIntentId, customerId, setupToken, onSaved }: {
  clientSecret: string;
  setupIntentId: string;
  customerId: string;
  setupToken: string;
  onSaved: (payment: SavedPayment) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const save = async () => {
    if (!stripe || !elements) return;
    setState("saving");
    setError("");
    const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message || "Card setup was not completed.");
      setState("idle");
      return;
    }
    try {
      const saved = await api("/api/finalize-setup-intent", { setupIntentId, customerId, setupToken });
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Card setup could not be finalized.");
      setState("idle");
    }
  };
  return <div className="stripe-setup-form">
    <PaymentElement options={{ layout: "tabs" }} />
    {error && <p className="form-error">{error}</p>}
    <button type="button" className="solid-button" disabled={!stripe || state === "saving"} onClick={save}>
      {state === "saving" ? "Securing card…" : <><LockKeyhole /> Save card securely</>}
    </button>
  </div>;
}

export default function StripeCardSetup({ fullName, email, savedPayment, onSaved, compact = false }: {
  fullName: string;
  email: string;
  savedPayment?: SavedPayment | null;
  onSaved: (payment: SavedPayment) => void;
  compact?: boolean;
}) {
  const [config, setConfig] = useState<{ configured: boolean; publishableKey: string | null } | null>(null);
  const [intent, setIntent] = useState<{ clientSecret: string; setupIntentId: string; customerId: string; setupToken: string } | null>(null);
  const [changing, setChanging] = useState(!savedPayment);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api("/api/stripe/config").then(setConfig).catch(() => setConfig({ configured: false, publishableKey: null })); }, []);
  const stripePromise = useMemo(() => config?.publishableKey ? loadStripe(config.publishableKey) : null, [config?.publishableKey]);
  const begin = async () => {
    setLoading(true);
    setError("");
    try {
      setIntent(await api("/api/create-setup-intent", { fullName, email, customerId: savedPayment?.customerId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Secure card setup is unavailable.");
    } finally {
      setLoading(false);
    }
  };
  if (!config) return <div className="payment-skeleton" aria-label="Loading secure payments" />;
  if (!config.configured) return <div className="payment-unavailable"><LockKeyhole /><span><b>Secure card setup ready to connect</b><small>Add Stripe credentials later to enable card saving and pre-authorization. Bookings can still be submitted as pay later.</small></span></div>;
  if (savedPayment && !changing) return <div className="saved-card-pill"><CreditCard /><span><small>Paying with saved card</small><b>{savedPayment.cardBrand.toUpperCase()} ending in {savedPayment.cardLast4}</b></span><Check /><button type="button" onClick={() => setChanging(true)}>Change</button></div>;
  if (!intent) return <div className={compact ? "stripe-start compact" : "stripe-start"}><button type="button" className="outline-button" disabled={loading || !fullName || !email} onClick={begin}><CreditCard />{loading ? "Opening secure form…" : savedPayment ? "Use a different card" : "Add payment card"}</button>{error && <p className="form-error">{error}</p>}</div>;
  return <Elements stripe={stripePromise} options={{
    clientSecret: intent.clientSecret,
    appearance: { theme: "night", variables: { colorPrimary: "#c9a56a", colorBackground: "#141613", colorText: "#f2eee5", borderRadius: "2px" } },
  }}><SetupForm {...intent} onSaved={payment => { onSaved(payment); setChanging(false); setIntent(null); }} /></Elements>;
}