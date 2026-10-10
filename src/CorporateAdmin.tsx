import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import type { CorporateAccountView } from "../shared/corporate";
import "./corporate.css";

type Status = "PENDING" | "ACTIVE" | "REJECTED" | "ALL";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body as T;
}
const statusText = (value: string) => value.toLowerCase().replaceAll("_", " ");

export default function CorporateAdmin() {
  const [status, setStatus] = useState<Status>("PENDING");
  const [accounts, setAccounts] = useState<CorporateAccountView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState<CorporateAccountView | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(async (next: string | null = null, append = false) => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ status });
      if (next) query.set("cursor", next);
      const result = await request<{ accounts: CorporateAccountView[]; nextCursor: string | null }>(`/api/admin/corporate/accounts?${query}`);
      setAccounts(current => append ? [...current, ...result.accounts] : result.accounts);
      setNextCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Corporate accounts could not be loaded."); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(null); }, [status, load]);
  const action = async (account: CorporateAccountView, kind: "approve" | "reject" | "resend", rejectionReason?: string) => {
    setBusyId(account.id); setError(""); setMessage("");
    try {
      const result = await request<{ account: CorporateAccountView; message?: string }>(`/api/admin/corporate/accounts/${encodeURIComponent(account.id)}/${kind}`, {
        method: "POST", body: JSON.stringify(kind === "reject" ? { reason: rejectionReason } : {}),
      });
      setAccounts(current => current.map(item => item.id === account.id ? result.account : item));
      setMessage(result.message || (kind === "reject" ? "Application rejected." : kind === "approve" ? "Account approved." : "Credential delivery retry submitted."));
      setRejecting(null); setReason("");
      if (kind !== "resend" && status === "PENDING") await load(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Unable to ${kind} this account.`); }
    finally { setBusyId(""); }
  };
  const approve = (account: CorporateAccountView) => {
    if (!account.paymentReady) { setError(`${account.companyLegalName} cannot be approved until Stripe confirms its saved payment method.`); return; }
    void action(account, "approve");
  };
  return <div className="admin-page corp-admin-page">
    <div className="admin-page-header"><div><p className="eyebrow brass">Accounts / corporate travel</p><h1>Company accounts</h1></div><button className="outline-button dark small" onClick={() => void load(null)} disabled={loading}><RefreshCw /> Refresh</button></div>
    <div className="corp-admin-summary"><ShieldCheck /><div><b>Approval &amp; delivery control</b><p>Verify the saved payment method before approval. Credentials are delivered as expiring temporary passwords and require a change at first sign-in.</p></div></div>
    <div className="corp-admin-toolbar"><div className="corp-admin-tabs" role="tablist" aria-label="Application status">{(["PENDING", "ACTIVE", "REJECTED", "ALL"] as Status[]).map(value => <button role="tab" aria-selected={status === value} className={status === value ? "selected" : ""} key={value} onClick={() => setStatus(value)}>{value === "ALL" ? "All accounts" : statusText(value)}</button>)}</div><span>{loading ? "Loading accounts…" : `${accounts.length} shown`}</span></div>
    {error && <p className="corp-message error" role="alert"><AlertTriangle />{error}<button onClick={() => void load(null)}>Retry</button></p>}
    {message && <p className="corp-message success" role="status"><Check />{message}</p>}
    {loading && accounts.length === 0 ? <div className="corp-admin-skeleton"><i /><i /><i /></div> : accounts.length === 0 ? <div className="corp-empty"><ShieldCheck /><h3>No {statusText(status)} applications.</h3><p>New company applications will appear here for staff review.</p></div> :
      <div className="corp-admin-list">{accounts.map(account => {
        const delivery = account.credentialsEmailStatus || "NOT_SENT";
        const deliveryUncertain = /pending|unknown|uncertain/i.test(delivery);
        const deliveryFailed = /fail|error|undeliver/i.test(delivery);
        return <article className="corp-admin-card" key={account.id}>
          <header><div><p className="corp-kicker">Applied {new Date(account.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p><h2>{account.companyLegalName}</h2><span>{account.contactName} · {account.contactEmail} · {account.contactPhone}</span></div><span className={`corp-status status-${account.status.toLowerCase()}`}>{statusText(account.status)}</span></header>
          <div className="corp-admin-details"><div><small>Monthly ride estimate</small><b>{account.monthlyRideVolume.toLocaleString()}</b></div><div><small>Billing profile</small><b>{account.billingName} · {account.billingEmail}</b></div><div><small>Receipt preference</small><b>{account.billingPreference === "ITEMIZED_PO_RECEIPTS" ? "Itemized PO receipt per ride" : "Email receipt per ride"}</b></div><div><small>Billing address</small><b>{account.billingAddress}</b></div><div><small>Saved Stripe method</small><b className={account.paymentReady ? "state-ready" : "state-pending"}>{account.paymentReady ? "Ready" : "Not confirmed"}</b></div><div><small>Credential email</small><b className={deliveryFailed || deliveryUncertain ? "state-pending" : "state-ready"}>{statusText(delivery)}</b></div></div>
          {(deliveryFailed || deliveryUncertain) && account.status === "ACTIVE" && <p className="corp-delivery-warning" role="status"><AlertTriangle />{deliveryUncertain ? "Email delivery is uncertain; verify delivery before asking the contact to sign in." : "Credential email failed. Use retry to reissue an expiring temporary password; the user must change it at first sign-in."}</p>}
          {account.rejectionReason && <p className="corp-rejection-reason"><b>Rejection reason</b> {account.rejectionReason}</p>}
          <footer>{account.status === "PENDING" && <><button className="corp-primary" onClick={() => approve(account)} disabled={busyId === account.id || !account.paymentReady}>{busyId === account.id ? "Processing…" : "Approve & send credentials"}</button><button className="corp-secondary" onClick={() => { setRejecting(account); setReason(""); }} disabled={busyId === account.id}>Reject application</button>{!account.paymentReady && <small>Approval is blocked until payment setup is complete.</small>}</>}{account.status === "ACTIVE" && <button className="corp-secondary" onClick={() => void action(account, "resend")} disabled={busyId === account.id}><Mail />{busyId === account.id ? "Checking delivery…" : "Retry credential delivery"}</button>}</footer>
        </article>;
      })}</div>}
    {nextCursor && <button className="corp-load-more" disabled={loading} onClick={() => void load(nextCursor, true)}>{loading ? "Loading…" : <>Load more <ChevronDown /></>}</button>}
    {rejecting && <div className="corp-modal-backdrop"><section className="corp-modal" role="dialog" aria-modal="true" aria-labelledby="corp-reject-title"><p className="corp-kicker">Application decision</p><h2 id="corp-reject-title">Reject this<br /><em>application?</em></h2><label>Reason<textarea rows={4} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>{error && <p className="corp-message error" role="alert">{error}</p>}<div><button className="corp-secondary" onClick={() => setRejecting(null)} disabled={Boolean(busyId)}>Keep application</button><button className="corp-danger" onClick={() => void action(rejecting, "reject", reason)} disabled={Boolean(busyId) || reason.trim().length < 3}>{busyId ? "Submitting…" : "Confirm rejection"}</button></div></section></div>}
  </div>;
}
