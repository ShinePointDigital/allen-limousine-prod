import crypto from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "./store.js";

type Assignment = { id: string; driverId: string | null; driverName: string | null; driverPhone: string | null; vehicleId: string | null };
type Access = Assignment & { driverAccessNonce: string | null; driverAccessTokenHash: string | null; driverAccessExpiresAt: Date | null; driverAccessAssignment: string | null };
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const assignment = (ride: Assignment) => digest(JSON.stringify([ride.driverId, ride.driverName, ride.driverPhone, ride.vehicleId]));
const include = { inquiry: true, driver: true, vehicle: true } as const;
export class DriverTripError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Separate, scoped capabilities: never use passenger tracking tokens or booking IDs. */
export class DriverTripService {
  constructor(
    private capture: (bookingRequestId: string) => Promise<unknown>,
    private db: PrismaClient = prisma,
    private secret: () => string = () => {
      if (!process.env.SESSION_SECRET) throw new Error("Driver access signing is not configured.");
      return process.env.SESSION_SECRET;
    },
  ) {}
  private token(ride: Access) {
    if (!ride.driverAccessNonce) throw new Error("Driver trip access has not been issued.");
    return crypto.createHmac("sha256", this.secret()).update(`driver-trip:${ride.id}:${ride.driverAccessNonce}`).digest("hex");
  }
  link(ride: Access, origin: string) {
    if (!ride.driverAccessNonce || ride.driverAccessAssignment !== assignment(ride)) return "";
    return new URL(`/driver/trip/${this.token(ride)}`, origin).toString();
  }
  async ensureForBooking(inquiryId: string) {
    const ride = await this.db.ride.findUnique({ where: { inquiryId } });
    if (ride?.driverPhone && ride.vehicleId && !["UNASSIGNED", "CANCELLED", "COMPLETED"].includes(ride.status)) await this.issue(ride.id);
  }
  async issue(rideId: string) {
    return this.db.$transaction(async db => {
      const ride = await db.ride.findUnique({ where: { id: rideId }, include });
      if (!ride || !ride.driverName || !ride.driverPhone || !ride.vehicleId || !ride.vehicle?.active ||
          (ride.driverId && !ride.driver?.active) || ["UNASSIGNED", "CANCELLED", "COMPLETED"].includes(ride.status) ||
          ["PAYMENT_PENDING", "CANCELLED"].includes(ride.inquiry.status) || ride.inquiry.paymentStatus === "canceled") {
        throw new DriverTripError(409, "Assign an active chauffeur and vehicle to an authorized trip first.");
      }
      const fingerprint = assignment(ride);
      if (ride.driverAccessAssignment === fingerprint && ride.driverAccessNonce && ride.driverAccessExpiresAt && ride.driverAccessExpiresAt > new Date() && digest(this.token(ride)) === ride.driverAccessTokenHash) return ride;
      const nonce = crypto.randomBytes(32).toString("hex");
      const token = this.token({ ...ride, driverAccessNonce: nonce });
      const expiresAt = new Date(Math.min(Math.max(ride.inquiry.pickupAt.getTime() + 48*3600000, Date.now()+86400000), Date.now()+9*86400000));
      return db.ride.update({ where: { id: ride.id }, data: {
        driverAccessNonce: nonce, driverAccessTokenHash: digest(token),
        driverAccessExpiresAt: expiresAt, driverAccessAssignment: fingerprint,
      }, include });
    }, { isolationLevel: "Serializable" });
  }
  private async authorized(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new DriverTripError(404, "This driver trip link is unavailable.");
    const ride = await this.db.ride.findUnique({ where: { driverAccessTokenHash: digest(token) }, include });
    if (!ride || !ride.driverAccessExpiresAt || ride.driverAccessExpiresAt <= new Date() ||
        ride.driverAccessAssignment !== assignment(ride) || digest(this.token(ride)) !== ride.driverAccessTokenHash || !ride.driverPhone || !ride.vehicle?.active ||
        (ride.driverId && !ride.driver?.active) || ["UNASSIGNED","CANCELLED"].includes(ride.status) ||
        ["PAYMENT_PENDING","CANCELLED"].includes(ride.inquiry.status) || ride.inquiry.paymentStatus === "canceled") {
      throw new DriverTripError(404, "This driver trip link expired, was reassigned, or is unavailable.");
    }
    return ride;
  }
  async get(token: string) {
    const ride = await this.authorized(token);
    const inquiry = ride.inquiry;
    return { reference: inquiry.id.slice(-6).toUpperCase(), customerName: inquiry.fullName,
      pickupAt: inquiry.pickupAt.toISOString(), pickup: inquiry.pickup, destination: inquiry.destination,
      serviceType: inquiry.serviceType, passengers: inquiry.passengers, chauffeurName: ride.driverName,
      vehicleName: ride.vehicle!.name, status: ride.status,
      airportCode: inquiry.airportCode, airportTerminal: inquiry.airportTerminal,
      flightNumber: inquiry.flightNumber, flightScheduledAt: inquiry.flightScheduledAt?.toISOString() ?? null,
      airlineName: inquiry.airlineName, pickupPreference: inquiry.pickupPreference,
      isPrivateFBO: inquiry.isPrivateFBO, specificTailNumber: inquiry.specificTailNumber,
      principalName: inquiry.principalName, fboName: inquiry.fboName,
      tarmacInstructions: inquiry.tarmacInstructions,
    };
  }
  async transition(token: string, status: "EN_ROUTE" | "IN_PROGRESS" | "COMPLETED") {
    const ride = await this.authorized(token);
    const next: Record<string,string> = { ASSIGNED:"EN_ROUTE", EN_ROUTE:"IN_PROGRESS", IN_PROGRESS:"COMPLETED" };
    if (ride.status !== status && next[ride.status] !== status) throw new DriverTripError(409, "Refresh the trip and select its next status. Statuses cannot be skipped or reversed.");
    if (status === "COMPLETED" && ride.inquiry.stripePaymentIntentId) {
      if (!ride.inquiry.bookingRequestId) throw new DriverTripError(409, "The authorized booking could not be identified.");
      try { await this.capture(ride.inquiry.bookingRequestId); }
      catch { throw new DriverTripError(402, "Trip completion could not be confirmed. The trip was not marked complete. Retry this same trip, or contact dispatch."); }
    }
    if (ride.status === status) return this.get(token);
    await this.db.$transaction(async db => {
      const changed = await db.ride.updateMany({
        where: { id: ride.id, status: ride.status,
          driverId: ride.driverId, driverName: ride.driverName, driverPhone: ride.driverPhone, vehicleId: ride.vehicleId,
          driverAccessTokenHash: ride.driverAccessTokenHash, driverAccessExpiresAt: { gt: new Date() } },
        data: { status },
      });
      if (changed.count !== 1) throw new DriverTripError(409, "The trip changed. Refresh before updating its status.");
      if (status === "COMPLETED") await db.inquiry.update({ where: { id: ride.inquiryId }, data: { status:"COMPLETED" } });
      await db.inquiryNote.create({ data: { inquiryId: ride.inquiryId, authorName: `Chauffeur: ${ride.driverName}`,
        body: `Driver trip: confirmed ${status === "IN_PROGRESS" ? "passenger picked up" : status === "EN_ROUTE" ? "en route" : "drop-off and completion"}.` } });
    });
    return this.get(token);
  }
}
