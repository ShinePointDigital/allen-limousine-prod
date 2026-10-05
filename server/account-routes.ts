import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ALL_PERMISSIONS, canCreateAccount, canEditAccount, hasAccess, isStaff, requiredAccess } from "../shared/access.js";
import { authenticate, changeCustomerPassword, createAdmin, deleteStaffAccount, getCustomerBookings, listAdmins, logout, sessionUser, setStaffPassword, updateAdmin } from "./store.js";

export const staffGuard: RequestHandler = async (req, res, next) => {
  const user = await sessionUser(req.cookies.allan_session);
  if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  if (!isStaff(user.role)) return res.status(403).json({ error: "Customer accounts cannot access the admin panel." });
  const permissions = requiredAccess(req.method, req.originalUrl.split("?")[0]);
  if (permissions === null || (permissions.length && !permissions.some(permission => hasAccess(user, permission)))) {
    return res.status(403).json({ error: "Your account does not have access to this area." });
  }
  res.locals.user = user;
  res.set("Cache-Control", "no-store");
  next();
};

const customerGuard: RequestHandler = async (req, res, next) => {
  const user = await sessionUser(req.cookies.allan_customer_session);
  if (!user || user.role !== "USER") return res.status(401).json({ error: "Please sign in to your customer account." });
  res.locals.customer = user;
  res.set("Cache-Control", "no-store");
  next();
};
const permissionsSchema = z.array(z.enum(ALL_PERMISSIONS as [typeof ALL_PERMISSIONS[number], ...typeof ALL_PERMISSIONS[number][]])).max(ALL_PERMISSIONS.length).transform(values => [...new Set(values)]);
const roleSchema = z.enum(["ADMIN", "SUPER_ADMIN", "USER"]);
const nameSchema = z.string().trim().min(2).max(100);
export const accountLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many sign-in attempts. Please try again later." } });
const requireSuperAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.user.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Only Super Admins can change staff passwords or delete staff accounts." });
  next();
};
const concurrentChange = (error: unknown) => (error as { code?: string }).code === "P2034";

export function createAccountRouter() {
  const router = express.Router();
  // Only guard against cross-site writes; tests and server-side clients may omit Origin.
  router.use(["/api/customer", "/api/admin/users"], (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Cross-site account changes are not allowed." });
      const origin = req.get("origin");
      if (origin) {
        try {
          const source = new URL(origin);
          // The development proxy removes the externally visible service port.
          // req.hostname uses the trusted proxy host; production remains port-exact.
          const forwardedHost = req.get("x-forwarded-host")?.split(",")[0].trim() || req.get("host");
          if (source.hostname !== req.hostname || (process.env.NODE_ENV === "production" && source.host !== forwardedHost)) return res.status(403).json({ error: "Cross-origin account changes are not allowed." });
        } catch { return res.status(403).json({ error: "Invalid request origin." }); }
      }
    }
    next();
  });
  router.get("/api/admin/users", staffGuard, async (_req, res) => {
    const users = await listAdmins();
    res.json({ users: res.locals.user.role === "SUPER_ADMIN" ? users : users.filter(user => user.role !== "SUPER_ADMIN") });
  });
  router.post("/api/admin/users", staffGuard, async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), name: nameSchema, password: z.string().min(12).max(200), role: roleSchema, permissions: permissionsSchema.default([]) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid name, email, role, access selection and password of at least 12 characters." });
    if ((parsed.data.role !== "ADMIN" && parsed.data.permissions.length) || !canCreateAccount(res.locals.user, parsed.data.role, parsed.data.permissions)) {
      return res.status(403).json({ error: "You cannot create that role or grant access beyond your own. Customer accounts have no staff access." });
    }
    try {
      res.status(201).json({ user: await createAdmin(parsed.data, res.locals.user) });
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN_ACCOUNT_CREATE") return res.status(403).json({ error: "Your account access changed. Refresh and try again." });
      if ((error as { code?: string }).code === "P2034") return res.status(409).json({ error: "Account access changed concurrently. Refresh and try again." });
      if ((error as { code?: string }).code === "P2002" || (error instanceof Error && /already exists/.test(error.message))) return res.status(409).json({ error: "An account with this email already exists." });
      throw error;
    }
  });
  router.patch("/api/admin/users/:id", staffGuard, async (req, res) => {
    const parsed = z.object({ name: nameSchema.optional(), active: z.boolean().optional(), role: roleSchema.optional(), permissions: permissionsSchema.optional() }).strict().refine(value => Object.keys(value).length > 0).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose valid account details, role and access." });
    const actor = res.locals.user;
    const target = (await listAdmins()).find(user => user.id === String(req.params.id));
    if (!target) return res.status(404).json({ error: "Account not found." });
    if (!canEditAccount(actor, target) || (actor.role !== "SUPER_ADMIN" && (parsed.data.role && parsed.data.role !== "USER" || parsed.data.permissions?.length))) return res.status(403).json({ error: "Only super-admins can change staff accounts and roles." });
    if (actor.id === target.id && (parsed.data.active !== undefined || parsed.data.role !== undefined || parsed.data.permissions !== undefined)) return res.status(409).json({ error: "You cannot change your own role, access or active status here." });
    if ((parsed.data.role ?? target.role) !== "ADMIN" && parsed.data.permissions?.length) return res.status(400).json({ error: "Only Admin accounts use selectable staff permissions." });
    try {
      const updated = await updateAdmin(target.id, parsed.data, actor);
      if (updated === "FORBIDDEN") return res.status(403).json({ error: "Your access or the target account changed. Refresh and try again." });
      if (updated === "LAST_SUPER_ADMIN") return res.status(409).json({ error: "At least one active super-admin is required." });
      res.json({ user: updated });
    } catch (error) {
      if ((error as { code?: string }).code === "P2034") return res.status(409).json({ error: "Account access changed concurrently. Refresh and try again." });
      throw error;
    }
  });
  router.post("/api/admin/users/:id/password", staffGuard, requireSuperAdmin, async (req, res) => {
    const parsed = z.object({ password: z.string().min(12).max(200) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a new password of 12–200 characters." });
    try {
      const result = await setStaffPassword(String(req.params.id), parsed.data.password, res.locals.user);
      if (result === "FORBIDDEN") return res.status(403).json({ error: "Your Super Admin access changed. Sign in again." });
      if (result === "NOT_FOUND") return res.status(404).json({ error: "Staff account not found." });
      if (result === "NOT_STAFF") return res.status(403).json({ error: "This password action is only available for staff accounts." });
      const signedOut = String(req.params.id) === res.locals.user.id;
      if (signedOut) res.clearCookie("allan_session", { path: "/" });
      res.json({ message: "Password changed. All staff sessions and previous reset links have been revoked.", signedOut });
    } catch (error) {
      if (concurrentChange(error)) return res.status(409).json({ error: "Account access changed concurrently. Refresh and try again." });
      throw error;
    }
  });
  router.delete("/api/admin/users/:id", staffGuard, requireSuperAdmin, async (req, res) => {
    try {
      const result = await deleteStaffAccount(String(req.params.id), res.locals.user);
      if (result === "FORBIDDEN") return res.status(403).json({ error: "Your Super Admin access changed. Sign in again." });
      if (result === "NOT_FOUND") return res.status(404).json({ error: "Staff account not found." });
      if (result === "NOT_STAFF") return res.status(403).json({ error: "Only staff accounts can be deleted here." });
      if (result === "SELF_DELETE") return res.status(409).json({ error: "You cannot delete your own account." });
      if (result === "LAST_SUPER_ADMIN") return res.status(409).json({ error: "The last active Super Admin cannot be deleted." });
      res.status(204).end();
    } catch (error) {
      if (concurrentChange(error)) return res.status(409).json({ error: "Account access changed concurrently. Refresh and try again." });
      throw error;
    }
  });
  router.post("/api/customer/login", accountLoginLimiter, async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
    const result = await authenticate(parsed.data.email, parsed.data.password, "customer");
    if (!result) return res.status(401).json({ error: "That customer email and password combination was not recognized." });
    await logout(req.cookies.allan_customer_session);
    res.cookie("allan_customer_session", result.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 60 * 60 * 1000, path: "/" });
    res.set("Cache-Control", "no-store").json({ user: result.user });
  });
  router.get("/api/customer/session", customerGuard, (_req, res) => res.json({ user: res.locals.customer }));
  router.get("/api/customer/bookings", customerGuard, async (_req, res) => {
    res.json({ bookings: await getCustomerBookings(res.locals.customer.id) });
  });
  router.post("/api/customer/logout", async (req, res) => {
    await logout(req.cookies.allan_customer_session);
    res.clearCookie("allan_customer_session", { path: "/" });
    res.status(204).end();
  });
  router.post("/api/customer/password", accountLoginLimiter, customerGuard, async (req, res) => {
    const parsed = z.object({ currentPassword: z.string().min(1).max(200), password: z.string().min(12).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Use a new password of 12–200 characters." });
    if (!await changeCustomerPassword(res.locals.customer.id, parsed.data.currentPassword, parsed.data.password)) return res.status(400).json({ error: "Your current password was not recognized." });
    res.clearCookie("allan_customer_session", { path: "/" });
    res.json({ message: "Password updated. All sessions have been signed out. Sign in with your new password." });
  });
  return router;
}
