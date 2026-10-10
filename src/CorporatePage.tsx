import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Check, Pause, Play, ShieldCheck } from "lucide-react";
import { CORPORATE_BILLING_TERMS, type CorporateApplicationInput } from "../shared/corporate";
import heroCadillac from "./assets/hero-cadillac-downtown-night.jpg";
import "./corporate.css";

type ApplicationResponse = { application: { id: string; status: string }; applicationToken: string };
type ApplicationDraft = Omit<CorporateApplicationInput, "billingConsent"> & { billingConsent: boolean };
const CORPORATE_APPLICATION_DRAFT_KEY = "corporate-application-draft";
const CORPORATE_APPLICATION_DRAFT_PROFILE_KEY = "corporate-application-draft-profile";
const CORPORATE_APPLICATION_DRAFT_LOCK_KEY = "corporate-application-draft-submitted";
const corporateApplicationTokenKey = (accountId: string) => `allan-corporate-application:${accountId}`;
const randomApplicationToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
};
const getDraftToken = () => {
  const existing = sessionStorage.getItem(CORPORATE_APPLICATION_DRAFT_KEY);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const token = randomApplicationToken();
  sessionStorage.setItem(CORPORATE_APPLICATION_DRAFT_KEY, token);
  return token;
};
const getDraftProfile = (): ApplicationDraft | null => {
  try {
    const raw = sessionStorage.getItem(CORPORATE_APPLICATION_DRAFT_PROFILE_KEY);
    return raw ? JSON.parse(raw) as ApplicationDraft : null;
  } catch { return null; }
};
const defaultApplication = (): ApplicationDraft => ({
  companyLegalName: "", contactName: "", contactEmail: "", contactPhone: "", monthlyRideVolume: 8,
  billingPreference: "EMAIL_RECEIPTS", billingName: "", billingEmail: "", billingAddress: "", billingConsent: false,
});
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed. Please try again.");
  return body as T;
}

export default function CorporatePage() {
  const location = useLocation();
  const heroVideo = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const [form, setForm] = useState<ApplicationDraft>(() => getDraftProfile() || defaultApplication());
  const [draftToken] = useState(getDraftToken);
  const [submissionLocked, setSubmissionLocked] = useState(() => sessionStorage.getItem(CORPORATE_APPLICATION_DRAFT_LOCK_KEY) === "true");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [returnSessionId, setReturnSessionId] = useState("");

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) {
        heroVideo.current?.pause();
        setVideoPlaying(false);
      }
    };
    updateMotionPreference();
    preference.addEventListener("change", updateMotionPreference);
    return () => preference.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("application");
    if (!id) return;
    setApplicationId(id);
    const saved = sessionStorage.getItem(corporateApplicationTokenKey(id)) || "";
    setToken(saved);
    const sessionId = params.get("session_id");
    if (!sessionId || !saved) {
      if (sessionId) setError("This browser session no longer has the application confirmation key. Contact Allan Limousine to safely complete payment setup.");
      return;
    }
    setReturnSessionId(sessionId);
    let cancelled = false;
    setConfirming(true);
    request<{ message: string }>(`/api/corporate/applications/${encodeURIComponent(id)}/payment-confirm`, {
      method: "POST", body: JSON.stringify({ applicationToken: saved, sessionId }),
    }).then(result => { if (!cancelled) { setNotice(result.message); setConfirmed(true); } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Payment setup could not be confirmed."); })
      .finally(() => { if (!cancelled) setConfirming(false); });
    return () => { cancelled = true; };
  }, [location.search]);

  const update = <K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) =>
    setForm(current => {
      const next = { ...current, [key]: value };
      sessionStorage.setItem(CORPORATE_APPLICATION_DRAFT_PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  const savePaymentMethod = async (id: string, capability: string) => {
    setBusy(true); setError("");
    try {
      const result = await request<{ url: string }>(`/api/corporate/applications/${encodeURIComponent(id)}/payment-setup`, {
        method: "POST", body: JSON.stringify({ applicationToken: capability }),
      });
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment setup could not be opened.");
      setBusy(false);
    }
  };
  const retryConfirmation = async () => {
    if (!applicationId || !token || !returnSessionId || confirming) return;
    setConfirming(true); setError("");
    try {
      const result = await request<{ message: string }>(`/api/corporate/applications/${encodeURIComponent(applicationId)}/payment-confirm`, {
        method: "POST", body: JSON.stringify({ applicationToken: token, sessionId: returnSessionId }),
      });
      setNotice(result.message); setConfirmed(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Payment setup could not be confirmed."); }
    finally { setConfirming(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    sessionStorage.setItem(CORPORATE_APPLICATION_DRAFT_LOCK_KEY, "true");
    sessionStorage.setItem(CORPORATE_APPLICATION_DRAFT_PROFILE_KEY, JSON.stringify(form));
    setSubmissionLocked(true);
    try {
      const result = await request<ApplicationResponse>("/api/corporate/applications", { method: "POST", body: JSON.stringify({ ...form, applicationToken: draftToken }) });
      sessionStorage.setItem(corporateApplicationTokenKey(result.application.id), result.applicationToken);
      sessionStorage.removeItem(CORPORATE_APPLICATION_DRAFT_KEY);
      sessionStorage.removeItem(CORPORATE_APPLICATION_DRAFT_PROFILE_KEY);
      sessionStorage.removeItem(CORPORATE_APPLICATION_DRAFT_LOCK_KEY);
      setApplicationId(result.application.id); setToken(result.applicationToken);
      setSubmissionLocked(false);
      setNotice("Application received. Add a saved payment method to complete review; approval remains subject to Allan Limousine staff review.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your application could not be submitted."); }
    finally { setBusy(false); }
  };

  return <main className="corp-page">
    <header className="corp-public-header"><Link to="/" className="corp-wordmark"><img src="/allan-limousine-logo.png" alt="Allan Limousine" /></Link><nav><Link to="/">Private travel</Link><Link to="/login">Corporate login <ArrowUpRight /></Link></nav></header>
    <section className={`corp-hero${reducedMotion ? " corp-hero-static" : ""}`}>
      <img className="corp-hero-poster" src={heroCadillac} alt="" aria-hidden="true" />
      {!reducedMotion && <video ref={heroVideo} className={`corp-hero-video${videoUnavailable ? " is-unavailable" : ""}`} autoPlay muted loop playsInline preload="metadata" poster={heroCadillac} aria-hidden="true" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} onError={() => { setVideoPlaying(false); setVideoUnavailable(true); }}>
        <source src="/hero-cadillac-edge-to-edge.mp4" type="video/mp4" />
      </video>}
      <div className="corp-hero-shade" aria-hidden="true" />
      <div className="corp-hero-copy"><p className="corp-kicker">ALLAN · CORPORATE TRAVEL</p><h1>Every journey,<br /><em>accounted for.</em></h1><p>One considered travel program for the people coordinating many rides. Staff approval, trip-level tracking, and payment charged only when each ride is completed.</p><div className="corp-hero-rule"><span>01</span><span>Company profile</span><i /><span>02</span><span>Saved payment method</span><i /><span>03</span><span>Staff review</span></div></div>
      <aside className="corp-hero-note"><ShieldCheck /><p>Built for accountable bookings.</p><span>Purchase orders and cost centers travel with every reservation. Each completed ride is charged to the company payment method on file.</span></aside>
      {!reducedMotion && !videoUnavailable && <button className="corp-motion-toggle" type="button" aria-label={videoPlaying ? "Pause hero video" : "Play hero video"} aria-pressed={videoPlaying} onClick={() => {
        const video = heroVideo.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => setVideoPlaying(false));
        else video.pause();
      }}>{videoPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}<span>{videoPlaying ? "Pause motion" : "Play motion"}</span></button>}
    </section>
    {confirmed ? <section className="corp-confirm"><span><Check /></span><p className="corp-kicker">Payment profile saved</p><h2>Application in<br /><em>review.</em></h2><p>{notice || "Your application is pending staff approval. We will contact the listed company representative."}</p><Link className="corp-secondary" to="/login">Corporate login <ArrowUpRight /></Link></section> :
      applicationId ? <section className="corp-confirm"><span><Check /></span><p className="corp-kicker">{confirming ? "Confirming Stripe setup" : "Application received"}</p><h2>{confirming ? "One moment." : <>Next, secure<br /><em>the account.</em></>}</h2><p>{notice || "Your application is pending staff approval. A saved payment method is required before it can be approved. Stripe securely collects payment details; no card data is entered on this site."}</p>{error && <p className="corp-message error" role="alert">{error}</p>}{error && returnSessionId && token && <button className="corp-secondary" disabled={confirming} onClick={() => void retryConfirmation()}>Retry payment confirmation</button>}<button className="corp-primary" disabled={busy || confirming || !token} onClick={() => void savePaymentMethod(applicationId, token)}>{busy ? "Opening Stripe…" : "Set up company payment method"} <ArrowUpRight /></button><button className="corp-text-action" onClick={() => { setApplicationId(""); setToken(""); setNotice(""); setError(""); }}>Return to application</button></section> :
      <section className="corp-application" id="application">
        <div className="corp-form-intro"><p className="corp-kicker">Company application</p><h2>Set up a more<br /><em>considered account.</em></h2><p>Applications are reviewed by our team. Payment information is collected through Stripe after this form is submitted.</p><Link className="corp-back" to="/"><ArrowLeft /> Return to Allan Limousine</Link></div>
        <form className="corp-form" onSubmit={submit}>
          <fieldset disabled={submissionLocked || busy}>
          <p className="corp-form-section">01 <span>Company &amp; coordinator</span></p>
          <label>Company legal name<input required minLength={2} maxLength={200} value={form.companyLegalName} onChange={e => update("companyLegalName", e.target.value)} /></label>
          <div className="corp-field-row"><label>Primary contact<input required value={form.contactName} onChange={e => update("contactName", e.target.value)} /></label><label>Business phone<input required type="tel" value={form.contactPhone} onChange={e => update("contactPhone", e.target.value)} /></label></div>
          <div className="corp-field-row"><label>Contact email<input required type="email" value={form.contactEmail} onChange={e => update("contactEmail", e.target.value)} /></label><label>Expected rides / month<input required type="number" min="1" max="100000" value={form.monthlyRideVolume} onChange={e => update("monthlyRideVolume", Number(e.target.value))} /></label></div>
          <p className="corp-form-section">02 <span>Billing profile</span></p>
          <div className="corp-field-row"><label>Billing contact name<input required value={form.billingName} onChange={e => update("billingName", e.target.value)} /></label><label>Billing email<input required type="email" value={form.billingEmail} onChange={e => update("billingEmail", e.target.value)} /></label></div>
          <label>Billing address<textarea required minLength={8} maxLength={500} rows={3} value={form.billingAddress} onChange={e => update("billingAddress", e.target.value)} /></label>
          <label>Receipt preference<select value={form.billingPreference} onChange={e => update("billingPreference", e.target.value as CorporateApplicationInput["billingPreference"])}><option value="EMAIL_RECEIPTS">Email receipt per ride</option><option value="ITEMIZED_PO_RECEIPTS">Itemized receipt with PO per ride</option></select><small>Both preferences are charged per completed ride. Invoice credit terms are not offered.</small></label>
          <label className="corp-consent"><input type="checkbox" required checked={form.billingConsent} onChange={e => update("billingConsent", e.target.checked)} /><span>{CORPORATE_BILLING_TERMS}</span></label>
          </fieldset>
          {error && <p className="corp-message error" role="alert">{error}</p>}
          <button className="corp-primary" disabled={busy}>{busy ? "Submitting application…" : submissionLocked ? <>Retry same application <ArrowUpRight /></> : <>Submit for review <ArrowUpRight /></>}</button>
          <p className="corp-form-foot">A payment method is required before approval. Stripe securely hosts the payment setup.</p>
        </form>
      </section>}
    <footer className="corp-footer"><span>ALLAN LIMOUSINE · CHICAGO</span><span>Private travel, thoughtfully managed.</span><Link to="/terms">Terms &amp; privacy</Link></footer>
  </main>;
}
