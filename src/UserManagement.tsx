import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, KeyRound, Pencil, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { ACCESS_OPTIONS, type Permission, type Role } from "../shared/access";
import "./UserManagement.css";

type Staff = { id: string; name: string; email: string; role: Role; permissions: Permission[]; active: boolean; createdAt: string };
type Actor = { id: string; name: string; email: string; role: Role; permissions: Permission[] };
type FormState = { name: string; email: string; password: string; role: Role; permissions: Permission[]; active: boolean };

const emptyForm = (): FormState => ({ name: "", email: "", password: "", role: "ADMIN", permissions: [], active: true });
const accessName = (role: Role) => role === "SUPER_ADMIN" ? "Super admin" : role === "ADMIN" ? "Administrator" : "User · customer";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

export default function UserManagement({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogUser, setDialogUser] = useState<Staff | null | undefined>(undefined);
  const [passwordTarget, setPasswordTarget] = useState<Staff | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Staff | undefined>(undefined);
  const [busyId, setBusyId] = useState("");
  const [resetId, setResetId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await request<{ users: Staff[] }>("/api/admin/users");
      setUsers(result.users);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveUser = async (form: FormState, existing?: Staff) => {
    setActionError("");
    const selfEdit = existing?.id === actor.id;
    const payload = existing
      ? { name: form.name, ...(!selfEdit && (actor.role === "SUPER_ADMIN" || existing.role === "USER") ? { active: form.active } : {}), ...(!selfEdit && actor.role === "SUPER_ADMIN" ? { role: form.role, permissions: form.role === "ADMIN" ? form.permissions : [] } : {}) }
      : { name: form.name, email: form.email, password: form.password, role: form.role, permissions: form.role === "ADMIN" ? form.permissions : [] };
    await request(existing ? `/api/admin/users/${existing.id}` : "/api/admin/users", { method: existing ? "PATCH" : "POST", body: JSON.stringify(payload) });
    setDialogUser(undefined);
    setNotice(existing ? "Account changes saved." : "Account created.");
    await load();
  };

  const toggleActive = async (user: Staff) => {
    setActionError("");
    setNotice("");
    setBusyId(user.id);
    try {
      await request(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) });
      setUsers(current => current.map(item => item.id === user.id ? { ...item, active: !item.active } : item));
      setNotice(`${user.name} ${user.active ? "disabled" : "enabled"}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update this account.");
    } finally { setBusyId(""); }
  };

  const sendReset = async (user: Staff) => {
    if (!window.confirm(`Send a password-reset link to ${user.email}?`)) return;
    setResetId(user.id); setActionError(""); setNotice("");
    try {
      const result = await request<{ message?: string }>(`/api/admin/users/${user.id}/password-reset`, { method: "POST" });
      setNotice(result.message || `Password-reset email requested for ${user.email}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to send a reset link.");
    } finally { setResetId(""); }
  };

  const setStaffPassword = async (user: Staff, password: string) => {
    setActionError("");
    setNotice("");
    const result = await request<{ message?: string; signedOut: boolean }>(`/api/admin/users/${user.id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setPasswordTarget(undefined);
    if (result.signedOut) {
      navigate("/admin/login", { replace: true, state: { staffPasswordChanged: true } });
      return;
    }
    setNotice(result.message || `Password changed for ${user.name}. Their active sessions and outstanding reset links have been revoked.`);
    void load();
  };

  const deleteStaff = async (user: Staff) => {
    setActionError("");
    setNotice("");
    setDeletingId(user.id);
    try {
      await request<void>(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setDeleteTarget(undefined);
      setNotice(`${user.name}’s staff account was permanently deleted. Booking and dispatch history was preserved.`);
      await load();
    } catch (error) {
      setDeleteTarget(undefined);
      setActionError(error instanceof Error ? error.message : "Unable to delete this staff account.");
      await load();
    } finally {
      setDeletingId("");
    }
  };

  const grouped = useMemo(() => [
    { label: "Staff", users: users.filter(user => user.role !== "USER") },
    { label: "Customers", users: users.filter(user => user.role === "USER") },
  ], [users]);

  return <main className="admin-page user-management">
    <header className="um-heading"><div><p className="eyebrow brass">Security / team access</p><h1>Users <em>& access</em></h1><p>Manage the people who run the service and the customers who book rides.</p></div><button className="solid-button um-create" onClick={() => setDialogUser(null)}><Plus /> Add user</button></header>
    <div className="um-policy"><ShieldCheck /><p><b>Access follows the role.</b> Super admins have all access. Administrators receive only the permissions assigned below. Customers can book and view linked reservations; they never access staff tools.</p></div>
    {actionError && <p className="um-alert error" role="alert">{actionError}</p>}
    {notice && <p className="um-alert success" role="status"><Check />{notice}</p>}
    {loading ? <div className="um-skeleton" aria-label="Loading users"><i /><i /><i /></div> : loadError ? <div className="um-state"><p>{loadError}</p><button className="outline-button dark small" onClick={() => void load()}>Try again</button></div> : users.length === 0 ? <div className="um-state"><Users /><h2>No accounts yet</h2><p>Create an administrator or customer account to get started.</p><button className="solid-button" onClick={() => setDialogUser(null)}><Plus /> Add user</button></div> :
      grouped.map(group => group.users.length > 0 && <section className="um-group" key={group.label}>
        <div className="um-group-title"><h2>{group.label}</h2><span>{group.users.length}</span></div>
        <div className="um-list">
          {group.users.map(user => {
            const isSelf = user.id === actor.id;
            const canEdit = actor.role === "SUPER_ADMIN" || user.role === "USER";
            const canReset = actor.role === "SUPER_ADMIN" && user.role !== "USER";
            const canSetPassword = actor.role === "SUPER_ADMIN" && user.role !== "USER";
            const canDelete = actor.role === "SUPER_ADMIN" && user.role !== "USER" && !isSelf;
            const permissionNames = user.role === "SUPER_ADMIN" ? "All staff access" : user.role === "USER" ? "Customer booking only" : (user.permissions || []).map(key => ACCESS_OPTIONS.find(option => option.key === key)?.label).filter(Boolean).join(" · ") || "No staff access";
            return <article className="um-row" key={user.id}>
              <div className="um-person"><span className="um-avatar">{user.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{user.name}{isSelf ? <small className="um-you">You</small> : null}</b><span>{user.email}</span></div></div>
              <div className="um-role"><span className={`um-role-tag role-${user.role.toLowerCase()}`}>{accessName(user.role)}</span><small>{permissionNames}</small></div>
              <div className="um-date"><span>Added</span>{new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
              <div className="um-actions"><span className={user.active ? "um-status active" : "um-status inactive"}><i />{user.active ? "Active" : "Disabled"}</span>
                {canEdit && <button className="um-icon-button" onClick={() => setDialogUser(user)} aria-label={`Edit ${user.name}`} title="Edit account"><Pencil /></button>}
                {!isSelf && (actor.role === "SUPER_ADMIN" || user.role === "USER") && <button className="um-text-button" disabled={busyId === user.id} onClick={() => void toggleActive(user)}>{busyId === user.id ? "Saving…" : user.active ? "Disable" : "Enable"}</button>}
                 {canSetPassword && <button className="um-text-button reset" onClick={() => setPasswordTarget(user)} aria-label={`Set password for ${user.name}`}><KeyRound /> Set password</button>}
                {canReset && <button className="um-text-button reset" disabled={!user.active || Boolean(resetId)} onClick={() => void sendReset(user)}>{resetId === user.id ? "Sending…" : <><KeyRound /> Reset password</>}</button>}
                 {canDelete && <button className="um-icon-button um-delete-button" onClick={() => setDeleteTarget(user)} aria-label={`Delete ${user.name}`} title="Delete staff account"><Trash2 /></button>}
              </div>
            </article>;
          })}
        </div>
      </section>)
    }
    {dialogUser !== undefined && <UserDialog actor={actor} user={dialogUser || undefined} onClose={() => setDialogUser(undefined)} onSave={saveUser} />}
    {passwordTarget && <StaffPasswordDialog user={passwordTarget} onClose={() => setPasswordTarget(undefined)} onSave={setStaffPassword} />}
    {deleteTarget && <DeleteStaffDialog user={deleteTarget} busy={deletingId === deleteTarget.id} onClose={() => setDeleteTarget(undefined)} onConfirm={() => void deleteStaff(deleteTarget)} />}
  </main>;
}

function StaffPasswordDialog({ user, onClose, onSave }: { user: Staff; onClose: () => void; onSave: (user: Staff, password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const validPassword = password.length >= 12 && password.length <= 200 && confirmPassword === password;
  const clearAndClose = () => {
    if (saving) return;
    setPassword("");
    setConfirmPassword("");
    onClose();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) clearAndClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validPassword || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(user, password);
      setPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to change this password.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="um-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) clearAndClose(); }}>
    <section className="um-dialog um-password-dialog" role="dialog" aria-modal="true" aria-labelledby="um-password-title" aria-describedby="um-password-warning">
      <header><div><p className="eyebrow brass">Staff security</p><h2 id="um-password-title">Set a new password</h2><p className="um-dialog-subtitle">{user.name} · {user.email}</p></div><button type="button" className="um-icon-button" onClick={clearAndClose} disabled={saving} aria-label="Close"><X /></button></header>
      <form onSubmit={submit}>
        <div className="um-password-warning" id="um-password-warning"><ShieldCheck /><p>Changing this password signs out all of {user.name}’s active sessions and revokes every outstanding password-reset link.</p></div>
        <label>New password<input autoFocus type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="um-password-help" /><small id="um-password-help">Use 12–200 characters.</small></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} aria-invalid={Boolean(confirmPassword && confirmPassword !== password)} /></label>
        {confirmPassword && confirmPassword !== password && <p className="um-inline-error" role="status">The passwords do not match.</p>}
        {error && <p className="um-alert error" role="alert">{error}</p>}
        <footer><button type="button" className="outline-button dark small" disabled={saving} onClick={clearAndClose}>Cancel</button><button className="solid-button" disabled={saving || !validPassword}>{saving ? "Saving…" : <>Change password <ArrowUpRight /></>}</button></footer>
      </form>
    </section>
  </div>;
}

function DeleteStaffDialog({ user, busy, onClose, onConfirm }: { user: Staff; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);
  return <div className="um-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="um-dialog um-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="um-delete-title" aria-describedby="um-delete-description">
      <header><div><p className="eyebrow brass">Permanent action</p><h2 id="um-delete-title">Delete staff account?</h2></div><button type="button" className="um-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></header>
      <p className="um-delete-copy" id="um-delete-description">This permanently removes <b>{user.name}</b>’s staff login and signs them out of active sessions. Their bookings, inquiries, rides, and dispatch history will be preserved.</p>
      <label className="um-delete-ack"><input type="checkbox" autoFocus checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand this permanently removes the staff account.</span></label>
      <footer><button type="button" className="outline-button dark small" disabled={busy} onClick={onClose}>Keep account</button><button type="button" className="um-danger-button" disabled={!acknowledged || busy} onClick={onConfirm}><Trash2 />{busy ? "Deleting…" : "Permanently delete"}</button></footer>
    </section>
  </div>;
}

function UserDialog({ actor, user, onClose, onSave }: { actor: Actor; user?: Staff; onClose: () => void; onSave: (form: FormState, existing?: Staff) => Promise<void> }) {
  const editing = Boolean(user);
  const [form, setForm] = useState<FormState>(() => user ? { name: user.name, email: user.email, password: "", role: user.role, permissions: user.permissions || [], active: user.active } : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canEditRole = actor.role === "SUPER_ADMIN" && !(user?.id === actor.id);
  const availablePermissions = ACCESS_OPTIONS.filter(option => actor.role === "SUPER_ADMIN" || actor.permissions.includes(option.key));
  const chooseRole = (role: Role) => setForm(current => ({ ...current, role, permissions: role === "ADMIN" ? current.permissions : [] }));
  const togglePermission = (permission: Permission) => setForm(current => ({ ...current, permissions: current.permissions.includes(permission) ? current.permissions.filter(item => item !== permission) : [...current.permissions, permission] }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave(form, user); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this account."); } finally { setSaving(false); }
  };
  return <div className="um-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="um-dialog" role="dialog" aria-modal="true" aria-labelledby="um-dialog-title">
      <header><div><p className="eyebrow brass">{editing ? "Account details" : "New account"}</p><h2 id="um-dialog-title">{editing ? "Edit user" : "Create user"}</h2></div><button type="button" className="um-icon-button" onClick={onClose} aria-label="Close"><X /></button></header>
      <form onSubmit={submit}>
        <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        {!editing && <><label>Email address<input type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>Initial password<input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /><small>Use 12–200 characters. Share it securely with the account holder.</small></label></>}
        {(canEditRole || !editing) && <label>Account type<select value={form.role} onChange={event => chooseRole(event.target.value as Role)}><option value="USER">User — customer</option><option value="ADMIN">Administrator</option>{actor.role === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Super admin</option>}</select></label>}
        {!canEditRole && editing && <div className="um-readonly"><span>Account type</span><b>{accessName(form.role)}</b><small>Only a super admin can change staff roles or access.</small></div>}
        {form.role === "ADMIN" && (canEditRole || !editing) && <fieldset className="um-permissions"><legend>Administrator access <span>Required selection</span></legend><p>Select only the areas this administrator needs. Your own access limits this list.</p>{availablePermissions.length ? availablePermissions.map(item => <label className="um-check" key={item.key}><input type="checkbox" checked={form.permissions.includes(item.key)} onChange={() => togglePermission(item.key)} /><span><b>{item.label}</b><small>{item.description}</small></span></label>) : <p className="um-no-access">You have no staff permissions to delegate.</p>}</fieldset>}
        {form.role === "SUPER_ADMIN" && <p className="um-note"><ShieldCheck /> Super admins automatically receive all staff access.</p>}
        {form.role === "USER" && <p className="um-note"><Users /> User means customer: access is limited to their own account and linked bookings.</p>}
        {editing && (actor.role === "SUPER_ADMIN" || user?.role === "USER") && user?.id !== actor.id && <label className="um-active-toggle"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Account is active</label>}
        {error && <p className="um-alert error" role="alert">{error}</p>}
        <footer><button type="button" className="outline-button dark small" disabled={saving} onClick={onClose}>Cancel</button><button className="solid-button" disabled={saving || (form.role === "ADMIN" && form.permissions.length === 0)}>{saving ? "Saving…" : editing ? <>Save changes <ArrowUpRight /></> : <>Create account <ArrowUpRight /></>}</button></footer>
      </form>
    </section>
  </div>;
}
