import { useEffect, useMemo, useRef, useState } from "react";
import { CardElement, Elements, ExpressCheckoutElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { StripeElementsOptions, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { Check, CreditCard, LockKeyhole } from "lucide-react";

export type SavedPayment = {
  customerId: string;
  paymentMethodId: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth?: number;
  cardExpYear?: number;
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

function SetupForm({ clientSecret, setupIntentId, customerId, setupToken, fullName, email, onSaved }: {
  clientSecret: string;
  setupIntentId: string;
  customerId: string;
  setupToken: string;
  fullName: string;
  email: string;
  onSaved: (payment: SavedPayment) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [state, setState] = useState<"idle" | "saving-card" | "saving-wallet">("idle");
  const savingRef = useRef(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [error, setError] = useState("");
  const beginSaving = (nextState: "saving-card" | "saving-wallet") => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setState(nextState);
    setError("");
    return true;
  };
  const resetSaving = () => {
    savingRef.current = false;
    setState("idle");
  };
  const finishSetup = async () => {
    const saved = await api("/api/finalize-setup-intent", { setupIntentId, customerId, setupToken });
    onSaved(saved);
  };
  const saveCard = async () => {
    if (!stripe || !elements) return;
    if (!beginSaving("saving-card")) return;
    const card = elements.getElement(CardElement);
    if (!card) {
      setError("The secure card form is not ready.");
      resetSaving();
      return;
    }
    try {
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card,
          billing_details: { name: fullName, email },
        },
      });
      if (result.error) throw result.error;
      await finishSetup();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Card setup could not be finalized.");
      resetSaving();
    }
  };
  const saveWallet = async (event: StripeExpressCheckoutElementConfirmEvent) => {
    if (!stripe || !elements) {
      event.paymentFailed({ reason: "fail", message: "Secure wallet setup is not ready." });
      return;
    }
    if (!beginSaving("saving-wallet")) {
      event.paymentFailed({ reason: "fail", message: "Another payment method is already being secured." });
      return;
    }
    try {
      const result = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });
      if (result.error) {
        event.paymentFailed({ reason: "fail", message: result.error.message });
        throw result.error;
      }
      await finishSetup();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Wallet setup could not be finalized.");
      resetSaving();
    }
  };
  return <div className="stripe-setup-form">
    <div className={`stripe-wallet-options${state === "idle" ? "" : " is-busy"}`} aria-busy={state === "saving-wallet"}>
      <ExpressCheckoutElement
        options={{
          paymentMethods: {
            applePay: "auto",
            googlePay: "auto",
            amazonPay: "never",
            link: "never",
            paypal: "never",
            klarna: "never",
          },
          paymentMethodOrder: ["apple_pay", "google_pay"],
          buttonTheme: { applePay: "black", googlePay: "black" },
          buttonType: { applePay: "plain", googlePay: "plain" },
          buttonHeight: 48,
          layout: { maxColumns: 2, maxRows: 1, overflow: "never" },
          billingAddressRequired: true,
          emailRequired: true,
        }}
        onReady={event => setWalletAvailable(Boolean(event.availablePaymentMethods?.applePay || event.availablePaymentMethods?.googlePay))}
        onAvailablePaymentMethodsChange={event => setWalletAvailable(Boolean(event.paymentMethods?.applePay?.available || event.paymentMethods?.googlePay?.available))}
        onLoadError={() => setWalletAvailable(false)}
        onConfirm={saveWallet}
      />
      {walletAvailable && <small>Use Apple Pay or Google Pay to securely save a payment method for this and future bookings.</small>}
    </div>
    {walletAvailable && <div className="stripe-payment-divider"><span>or pay with card</span></div>}
    <label className="stripe-card-field">
      <span>Credit or debit card</span>
      <CardElement options={{
        hidePostalCode: false,
        style: {
          base: {
            color: "#f2eee5",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            "::placeholder": { color: "#777b73" },
            iconColor: "#c9a56a",
          },
          invalid: { color: "#ff9d94", iconColor: "#ff9d94" },
        },
      }} />
    </label>
    {error && <p className="form-error">{error}</p>}
    <button type="button" className="solid-button" disabled={!stripe || state !== "idle"} onClick={saveCard}>
      {state === "saving-card" ? "Securing card…" : state === "saving-wallet" ? "Securing wallet…" : <><LockKeyhole /> Save card securely</>}
    </button>
  </div>;
}

export default function StripeCardSetup({ fullName, email, savedPayment, onSaved, compact = false, requiredPayment = false }: {
  fullName: string;
  email: string;
  savedPayment?: SavedPayment | null;
  onSaved: (payment: SavedPayment) => void;
  compact?: boolean;
  requiredPayment?: boolean;
}) {
  const [config, setConfig] = useState<{ configured: boolean; publishableKey: string | null } | null>(null);
  const [intent, setIntent] = useState<{ clientSecret: string; setupIntentId: string; customerId: string; setupToken: string } | null>(null);
  const [changing, setChanging] = useState(!savedPayment);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api("/api/stripe/config").then(setConfig).catch(() => setConfig({ configured: false, publishableKey: null })); }, []);
  const stripePromise = useMemo(() => config?.publishableKey ? loadStripe(config.publishableKey) : null, [config?.publishableKey]);
  const elementsOptions = useMemo<StripeElementsOptions | undefined>(() => intent ? ({
    clientSecret: intent.clientSecret,
    appearance: {
      theme: "night",
      variables: {
        colorPrimary: "#c9a56a",
        colorBackground: "#171916",
        colorText: "#f2eee5",
        colorDanger: "#ff9d94",
        fontFamily: "Inter, system-ui, sans-serif",
        borderRadius: "0px",
      },
    },
  }) : undefined, [intent?.clientSecret]);
  const begin = async () => {
    setLoading(true);
    setError("");
    try {
      setIntent(await api("/api/create-setup-intent", { fullName, email }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Secure card setup is unavailable.");
    } finally {
      setLoading(false);
    }
  };
  if (!config) return <div className="payment-skeleton" aria-label="Loading secure payments" />;
  if (!config.configured) return <div className="payment-unavailable"><LockKeyhole /><span><b>Secure card setup is unavailable</b><small>{requiredPayment ? "Payment authorization is required to finish this booking. Please try again when Stripe is connected." : "Add Stripe credentials later to enable card saving and pre-authorization. You can continue without a saved card."}</small></span></div>;
  if (savedPayment && !changing) return <div className="saved-card-pill"><CreditCard /><span><small>Paying with saved card</small><b>{savedPayment.cardBrand.toUpperCase()} ending in {savedPayment.cardLast4}</b></span><Check /><button type="button" onClick={() => setChanging(true)}>Change</button></div>;
  if (!intent) return <div className={compact ? "stripe-start compact" : "stripe-start"}><button type="button" className="outline-button" disabled={loading || !fullName || !email} onClick={begin}><CreditCard />{loading ? "Opening secure form…" : savedPayment ? "Use a different card" : "Add payment card"}</button>{error && <p className="form-error">{error}</p>}</div>;
  return <Elements stripe={stripePromise} options={elementsOptions}><SetupForm {...intent} fullName={fullName} email={email} onSaved={payment => { onSaved(payment); setChanging(false); setIntent(null); }} /></Elements>;
}