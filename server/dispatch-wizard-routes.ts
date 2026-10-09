import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./store.js";
import { normalizeTwilioPhone } from "./twilio.js";
import { validPassengerCapacity } from "../shared/chauffeur-pairing.js";
import { activeRideStatuses, samePhone, DispatchWizardError, DispatchWizardService } from "./dispatch-wizard-service.js";
import { DriverTripError, type DriverTripService } from "./driver-trip-service.js";

type Options = {
  admin: express.RequestHandler;
  sendSms: (phone: string, body: string) => Promise<{ providerMessageId: string | null; providerStatus: string | null }>;
  service?: DispatchWizardService;
  driverAccess?: DriverTripService;
  publicOrigin?: (req: express.Request) => string;
};
const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
const assignSchema = z.object({
  version: z.number().int().nonnegative(),
  action: z.enum(["save", "dispatch"]).default("dispatch"),
  driverId: z.string().min(1).max(100).optional(),
  // Compatibility assertion for older clients; the server still derives the vehicle.
  vehicleId: z.string().min(1).max(100).optional(),
}).strict().refine(value =>
  value.action === "save" ? Boolean(value.driverId) : !value.driverId && !value.vehicleId, "Choose a chauffeur to save the assignment.");
const vehicleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(500),
  imageUrl: z.string().url().max(2000),
  passengers: z.string().trim().min(1).max(30).refine(validPassengerCapacity),
  luggage: z.string().trim().min(1).max(30),
}).strict();
const vehicleChoiceSchema = z.object({
  vehicleId: z.string().trim().min(1).max(100).optional(),
  newVehicle: vehicleSchema.optional(),
}).strict().refine(value => Boolean(value.vehicleId) !== Boolean(value.newVehicle), "Choose one existing vehicle or enter a new vehicle.");
const createChauffeurSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  vehicleId: z.string().trim().min(1).max(100).optional(),
  newVehicle: vehicleSchema.optional(),
}).strict().refine(value => Boolean(value.vehicleId) !== Boolean(value.newVehicle), "Choose one existing vehicle or enter a new vehicle.");

async function selectOrCreateVehicle(
  db: Prisma.TransactionClient,
  choice: { vehicleId?: string; newVehicle?: z.infer<typeof vehicleSchema> },
  driver: { id?: string; name: string; phone: string },
) {
  if (choice.newVehicle) {
    return db.fleetVehicle.create({
      data: {
        ...choice.newVehicle,
        defaultDriverName: driver.name,
        defaultDriverPhone: driver.phone,
        sortOrder: await db.fleetVehicle.count(),
      },
    });
  }
  if (!choice.vehicleId) throw new DispatchWizardError(400, "Choose a fleet vehicle.");
  const vehicle = await db.fleetVehicle.findUnique({
    where: { id: choice.vehicleId },
    include: { chauffeur: { select: { id: true } } },
  });
  if (!vehicle?.active) throw new DispatchWizardError(409, "Choose an active fleet vehicle.");
  if (vehicle.chauffeur && vehicle.chauffeur.id !== driver.id) {
    throw new DispatchWizardError(409, "This fleet vehicle is already paired with another chauffeur.");
  }
  const busy = await db.ride.findFirst({
    where: { vehicleId: vehicle.id, status: { in: activeRideStatuses } },
    select: { id: true },
  });
  if (busy) throw new DispatchWizardError(409, "This vehicle is assigned to an active ride and cannot be paired yet.");
  return db.fleetVehicle.update({
    where: { id: vehicle.id },
    data: { defaultDriverName: driver.name, defaultDriverPhone: driver.phone },
  });
}

export function createDispatchWizardRouter(options: Options) {
  const router = express.Router();
  const serviceFor = (req: express.Request) => options.service || new DispatchWizardService(
    options.sendSms, prisma, undefined,
    options.driverAccess && options.publicOrigin ? ride => options.driverAccess!.link(ride, options.publicOrigin!(req)) : undefined,
  );
  const dispatchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
  const handle = (callback: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
    async (req, res) => {
      try { await callback(req, res); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        const status = error instanceof DriverTripError ? error.status : error instanceof DispatchWizardError ? error.statusCode : code === "P2034" || code === "P2002" ? 409 : ["P2021", "P2022"].includes(code) ? 503 : 500;
        const message = error instanceof DispatchWizardError || error instanceof DriverTripError ? error.message :
          status === 409 ? "Another dispatcher changed this booking, or this chauffeur/vehicle is already paired. Refresh and try again." :
          status === 503 ? "The dispatch database migration must be applied before this wizard can be used." :
          "Dispatch could not be completed. Refresh to check the saved progress before retrying.";
        console.error("Dispatch wizard request failed:", error instanceof DispatchWizardError ? error.message : code || "internal error");
        let snapshot;
        if (req.params.id) {
          try { snapshot = await serviceFor(req).snapshot(String(req.params.id)); } catch { /* Never hide the original failure. */ }
        }
        res.status(status).json({ error: message, ...(snapshot ? { snapshot } : {}) });
      }
    };
  router.get("/api/admin/bookings/:id/dispatch", options.admin, handle(async (req, res) => {
    await options.driverAccess?.ensureForBooking(String(req.params.id));
    res.json(await serviceFor(req).snapshot(String(req.params.id)));
  }));
  router.post("/api/admin/bookings/:id/review", options.admin, handle(async (req, res) => {
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A valid saved workflow version is required." });
    res.json(await serviceFor(req).review(String(req.params.id), parsed.data.version, res.locals.user));
  }));
  router.post("/api/admin/bookings/:id/assign", options.admin, dispatchLimiter, handle(async (req, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose one chauffeur and include the saved workflow version." });
    const id = String(req.params.id);
    const actor = res.locals.user;
    const version = parsed.data.version;
    if (parsed.data.action === "save" && parsed.data.driverId) {
      await serviceFor(req).assign(id, version, parsed.data.driverId, actor, parsed.data.vehicleId);
      await options.driverAccess?.ensureForBooking(id);
      return res.json(await serviceFor(req).snapshot(id));
    }
    await options.driverAccess?.ensureForBooking(id);
    res.json(await serviceFor(req).dispatch(id, version, actor));
  }));
  router.get("/api/admin/chauffeurs", options.admin, handle(async (_req, res) => {
    res.json({ chauffeurs: await prisma.chauffeur.findMany({ where: { active: true }, include: { fleetVehicle: true }, orderBy: { name: "asc" } }) });
  }));
  router.post("/api/admin/chauffeurs", options.admin, handle(async (req, res) => {
    const parsed = createChauffeurSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the chauffeur's details and pair them with one existing or new vehicle." });
    let normalized: string;
    try { normalized = normalizeTwilioPhone(parsed.data.phone, "recipient"); }
    catch { return res.status(400).json({ error: "Enter a valid chauffeur phone number, including its country code." }); }
    const chauffeur = await prisma.$transaction(async db => {
      const vehicle = await selectOrCreateVehicle(db, parsed.data, { name: parsed.data.name, phone: normalized });
      return db.chauffeur.create({
        data: { name: parsed.data.name, phone: normalized, fleetVehicleId: vehicle.id },
        include: { fleetVehicle: true },
      });
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ chauffeur });
  }));
  router.post("/api/admin/chauffeurs/:chauffeurId/vehicle", options.admin, handle(async (req, res) => {
    const parsed = vehicleChoiceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose one existing vehicle or enter the new vehicle details." });
    const chauffeurId = String(req.params.chauffeurId);
    const chauffeur = await prisma.$transaction(async db => {
      const current = await db.chauffeur.findUnique({ where: { id: chauffeurId }, include: { fleetVehicle: true } });
      if (!current?.active) throw new DispatchWizardError(404, "Active chauffeur not found.");
      if (current.fleetVehicleId) throw new DispatchWizardError(409, "This chauffeur already has a fixed vehicle pairing.");
      const activeRides = await db.ride.findMany({
        where: { status: { in: activeRideStatuses } },
        select: { driverId: true, driverPhone: true },
      });
      if (activeRides.some(ride => ride.driverId === current.id ||
        Boolean(ride.driverPhone && samePhone(ride.driverPhone, current.phone)))) {
        throw new DispatchWizardError(409, "This chauffeur is assigned to an active ride and cannot be paired yet.");
      }
      const vehicle = await selectOrCreateVehicle(db, parsed.data, { id: current.id, name: current.name, phone: current.phone });
      return db.chauffeur.update({
        where: { id: current.id },
        data: { fleetVehicleId: vehicle.id },
        include: { fleetVehicle: true },
      });
    }, { isolationLevel: "Serializable" });
    res.json({ chauffeur });
  }));
  return router;
}
