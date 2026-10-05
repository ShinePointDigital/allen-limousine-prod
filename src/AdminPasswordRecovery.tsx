import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import "./admin-recovery.css";

export default function AdminPasswordRecovery({ mode }: { mode: "forgot" | "reset" }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode === "reset" && window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [mode]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "reset" && password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/${mode === "forgot" ? "forgot-password" : "reset-password"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "forgot" ? { email } : { token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to process this request.");
      setMessage(data.message);
      setPassword("");
      setConfirmation("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to process this request."); }
    finally { setBusy(false); }
  };
  return <div className="login-page"><div className="login-image" /><div className="login-panel">
    <Link to="/" className="mark mark-logo" aria-label="Allan Limousine home"><img src="/allan-limousine-logo.png" alt="Allan Limousine" /></Link>
    <div className="login-form">
      <p className="eyebrow brass">Account recovery</p>
      <h1>{mode === "forgot" ? <>Forgot your<br /><em>password?</em></> : <>Choose a new<br /><em>password.</em></>}</h1>
      <p className="muted">{mode === "forgot" ? "Enter your administrator email to request a secure, single-use reset link." : "Use at least 12 characters. Changing your password signs out all existing sessions."}</p>
      {message ? <div className="recovery-success" role="status"><p>{message}</p><Link className="text-button" to="/admin/login">Return to sign in <ArrowUpRight /></Link>{mode === "forgot" && <button type="button" className="text-button" onClick={() => setMessage("")}>Request another link</button>}</div> :
        mode === "reset" && !token ? <p className="form-error" role="alert">A reset token is missing. <Link to="/admin/forgot-password">Request a new reset link.</Link></p> :
          <form onSubmit={submit}>
            {mode === "forgot" ? <label>Email address<input type="email" required maxLength={254} autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label> : <>
              <label>New password<input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
              <label>Confirm new password<input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
            </>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="solid-button submit-button" disabled={busy}>{busy ? "Please wait…" : <>{mode === "forgot" ? "Send reset link" : "Update password"} <ArrowUpRight /></>}</button>
          </form>}
      <p className="login-note"><Link to="/admin/login">Back to sign in</Link> · {mode === "reset" ? <Link to="/admin/forgot-password">Request a new link</Link> : <Link to="/">Return to site</Link>}</p>
    </div>
  </div></div>;
}