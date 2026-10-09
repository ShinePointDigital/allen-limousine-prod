export const ACCESS_OPTIONS = [
  { key: "dashboard", label: "Overview", description: "Booking summaries, activity and financial totals." },
  { key: "rides", label: "Rides & dispatch", description: "Assign vehicles, dispatch chauffeurs and update trips." },
  { key: "sms", label: "SMS inbox", description: "Read and reply to customer and chauffeur SMS conversations; honor opt-outs." },
  { key: "inquiries", label: "Inquiries", description: "Read and manage customer inquiries and internal notes." },
  { key: "services", label: "Services", description: "Add, edit and remove service offerings." },
  { key: "fleet", label: "Fleet", description: "Add, edit and remove vehicles and driver defaults." },
  { key: "content", label: "Site content", description: "Edit public website copy." },
  { key: "settings", label: "Company settings", description: "Edit business contact details." },
  { key: "payments", label: "Payments", description: "Capture or cancel card holds, including completing paid rides." },
  { key: "export", label: "Export bookings", description: "Download customer booking data." },
] as const;
export type Permission = typeof ACCESS_OPTIONS[number]["key"];
export type Role = "SUPER_ADMIN" | "ADMIN" | "USER";
export type AccountAccess = { id: string; role: string; permissions?: readonly string[] };
export const ALL_PERMISSIONS: Permission[] = ACCESS_OPTIONS.map(option => option.key);
export const isStaff = (role: string) => role === "ADMIN" || role === "SUPER_ADMIN";
export function effectivePermissions(account: Pick<AccountAccess, "role" | "permissions">): Permission[] {
  if (account.role === "SUPER_ADMIN") return [...ALL_PERMISSIONS];
  if (account.role !== "ADMIN") return [];
  return ALL_PERMISSIONS.filter(permission => account.permissions?.includes(permission));
}
export function hasAccess(account: Pick<AccountAccess, "role" | "permissions">, permission: string) {
  return effectivePermissions(account).includes(permission as Permission);
}
export function canCreateAccount(actor: AccountAccess, role: Role, permissions: readonly string[]) {
  if (!isStaff(actor.role)) return false;
  if (role === "USER") return permissions.length === 0;
  if (role === "SUPER_ADMIN") return actor.role === "SUPER_ADMIN";
  return permissions.every(permission => hasAccess(actor, permission));
}
export function canEditAccount(actor: AccountAccess, target: AccountAccess) {
  return actor.role === "SUPER_ADMIN" || (actor.role === "ADMIN" && target.role === "USER");
}
// Staff account management and personal session controls are role-based.
export function requiredAccess(method: string, path: string): Permission[] | null {
  if (method === "GET" && /^\/api\/flights\/[^/]+$/.test(path)) return ["rides"];
  if (/^\/api\/admin\/(session|sessions(?:\/others)?|users(?:\/[^/]+(?:\/(?:password-reset|password))?)?)$/.test(path)) return [];
  if (path === "/api/admin/company-profile") return method === "GET" ? [] : ["settings"];
  if (path === "/api/admin/content") return ["services", "fleet", "content"];
  if (path === "/api/admin/content/site") return ["content"];
  if (path.startsWith("/api/admin/content/services")) return ["services"];
  if (path.startsWith("/api/admin/content/fleet")) return ["fleet"];
  if (path === "/api/admin/dashboard") return ["dashboard"];
  if (path.startsWith("/api/admin/payments/")) return ["payments"];
  if (path.startsWith("/api/admin/sms/")) return ["sms"];
  if (method === "POST" && /^\/api\/admin\/rides\/[^/]+\/capture$/.test(path)) return ["rides", "payments"];
  if (path.startsWith("/api/admin/rides")) return ["rides"];
  if (path.startsWith("/api/admin/bookings/") || path.startsWith("/api/admin/chauffeurs")) return ["rides"];
  if (path.startsWith("/api/admin/inquiries") || path.startsWith("/api/admin/notifications")) return ["inquiries"];
  if (path === "/api/admin/export.csv") return ["export"];
  return null;
}
