import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "./store.js";
import { normalizeTwilioPhone } from "./twilio.js";
import { DispatchWizardError, DispatchWizardService } from "./dispatch-wizard-service.js";

type Options = {
  admin: express.RequestHandler;
  sendSms: (phone: string, body: string) => Promise<{ providerMessageId: string | null; providerStatus: string | null }>;
  service?: DispatchWizardService;
};
const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
const assignSchema = z.object({
  version: z.number().int().nonnegative(),
  action: z.enum(["save", "dispatch"]).default("dispatch"),
  driverId: z.string().min(1).max(100).optional(),
  vehicleId: z.string().min(1).max(100).optional(),
}).strict().refine(value =>
  Boolean(value.driverId) === Boolean(value.vehicleId) &&
  (value.action !== "save" || Boolean(value.driverId)), "Choose both a chauffeur and vehicle.");

export function createDispatchWizardRouter(options: Options) {
  const router = express.Router();
  const service = options.service || new DispatchWizardService(options.sendSms);
  const dispatchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
  const handle = (callback: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
    async (req, res) => {
      try { await callback(req, res); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        const status = error instanceof DispatchWizardError ? error.statusCode : code === "P2034" || code === "P2002" ? 409 : ["P2021", "P2022"].includes(code) ? 503 : 500;
        const message = error instanceof DispatchWizardError ? error.message :
          status === 409 ? "Another dispatcher updated this booking or this chauffeur already exists. Refresh and try again." :
          status === 503 ? "The dispatch database migration must be applied before this wizard can be used." :
          "Dispatch could not be completed. Refresh to check the saved progress before retrying.";
        console.error("Dispatch wizard request failed:", error instanceof DispatchWizardError ? error.message : code || "internal error");
        let snapshot;
        if (req.params.id) {
          try { snapshot = await service.snapshot(String(req.params.id)); } catch { /* Never hide the original failure. */ }
        }
        res.status(status).json({ error: message, ...(snapshot ? { snapshot } : {}) });
      }
    };
  router.get("/api/admin/bookings/:id/dispatch", options.admin, handle(async (req, res) => {
    res.json(await service.snapshot(String(req.params.id)));
  }));
  router.post("/api/admin/bookings/:id/review", options.admin, handle(async (req, res) => {
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A valid saved workflow version is required." });
    res.json(await service.review(String(req.params.id), parsed.data.version, res.locals.user));
  }));
  router.post("/api/admin/bookings/:id/assign", options.admin, dispatchLimiter, handle(async (req, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a chauffeur and vehicle, and include the saved workflow version." });
    const id = String(req.params.id);
    const actor = res.locals.user;
    let version = parsed.data.version;
    if (parsed.data.driverId && parsed.data.vehicleId) {
      const saved = await service.assign(id, version, parsed.data.driverId, parsed.data.vehicleId, actor);
      if (parsed.data.action === "save") return res.json(saved);
      version = saved.version;
    }
    res.json(await service.dispatch(id, version, actor));
  }));
  router.get("/api/admin/chauffeurs", options.admin, handle(async (_req, res) => {
    res.json({ chauffeurs: await prisma.chauffeur.findMany({ where: { active: true }, orderBy: { name: "asc" } }) });
  }));
  router.post("/api/admin/chauffeurs", options.admin, handle(async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(30) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the chauffeur's name and a valid phone number." });
    let normalized: string;
    try { normalized = normalizeTwilioPhone(parsed.data.phone, "recipient"); }
    catch { return res.status(400).json({ error: "Enter a valid chauffeur phone number, including its country code." }); }
    res.status(201).json({ chauffeur: await prisma.chauffeur.create({ data: { name: parsed.data.name, phone: normalized } }) });
  }));
  return router;
}
