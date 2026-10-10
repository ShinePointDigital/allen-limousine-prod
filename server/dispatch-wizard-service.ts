import { Prisma, type PrismaClient } from "@prisma/client";
import { SMS_BRAND } from "../shared/sms-program.js";
import { prisma, dispatchBrief } from "./store.js";
import { smsRecipientOptedOut } from "./sms-inbox-store.js";
import { normalizeTwilioPhone, TwilioRequestError } from "./twilio.js";
import { bookingHasSmsConsent } from "../shared/sms-consent.js";
import type { DispatchWizardSnapshot, WizardSmsPreview } from "../shared/dispatch-wizard.js";

const include = {
  inquiryNotes: true,
  ride: { include: { vehicle: true, driver: true, dispatchMessages: { orderBy: { createdAt: "desc" as const } } } },
} as const;
type Booking = Prisma.InquiryGetPayload<{ include: typeof include }>;
type Attempt = NonNullable<Booking["ride"]>["dispatchMessages"][number];
type Actor = { id: string; name: string };
type SendSms = (phone: string, body: string) => Promise<{ providerMessageId: string | null; providerStatus: string | null }>;
export const activeRideStatuses = ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS"];
const phone = (value: string) => normalizeTwilioPhone(value, "recipient");
export const samePhone = (a: string, b: string) => {
  try { return phone(a) === phone(b); } catch { return a === b; }
};

export class DispatchWizardError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
function conflict(message: string): never { throw new DispatchWizardError(409, message); }

/** SMS transport is deliberately injected: tests never contact Twilio. */
export class DispatchWizardService {
  constructor(
    private sendSms: SendSms,
    private db: PrismaClient = prisma,
    private optedOut: (phone: string) => Promise<boolean> = smsRecipientOptedOut,
    private driverLink?: (ride: NonNullable<Booking["ride"]>) => string,
  ) {}

  private async record(id: string, db: Prisma.TransactionClient = this.db) {
    const booking = await db.inquiry.findUnique({ where: { id }, include });
    if (!booking || booking.status === "PAYMENT_PENDING") throw new DispatchWizardError(404, "Booking not found.");
    return booking;
  }

  private mutable(booking: Booking) {
    if (["CANCELLED", "COMPLETED"].includes(booking.status) ||
      ["CANCELLED", "COMPLETED", "EN_ROUTE", "IN_PROGRESS"].includes(booking.ride?.status || "") ||
      ["canceled", "authorization_pending"].includes(booking.paymentStatus || "")) {
      conflict("This booking cannot be dispatched in its current trip/payment state.");
    }
  }

  private assigned(booking: Booking) {
    const ride = booking.ride;
    return Boolean(ride?.vehicle?.active && ride.driverName && ride.driverPhone &&
      (!ride.driverId || ride.driver?.active) && activeRideStatuses.includes(ride.status));
  }

  private attempts(booking: Booking, recipient: "DRIVER" | "CUSTOMER") {
    const destination = recipient === "DRIVER" ? booking.ride?.driverPhone || "" : booking.phone;
    return (booking.ride?.dispatchMessages || []).filter(attempt =>
      samePhone(attempt.toPhone, destination) &&
      (attempt.dispatchRecipient === recipient || (recipient === "DRIVER" && !attempt.dispatchRecipient)));
  }

  private chosenAttempt(booking: Booking, recipient: "DRIVER" | "CUSTOMER") {
    const attempts = this.attempts(booking, recipient);
    return attempts.find(item => item.status === "SENT") ||
      (booking.dispatchStep === 4 ? booking.ride?.dispatchMessages.find(item =>
        item.dispatchRecipient === recipient && ["SENT", "SKIPPED"].includes(item.status)) : undefined) ||
      attempts.find(item => ["PENDING", "RESERVED"].includes(item.status)) || attempts[0];
  }

  private bodies(booking: Booking) {
    const ride = booking.ride;
    // Preserve in-flight legacy messages exactly: changing their bodies makes
    // an uncertain provider outcome impossible to reconcile safely.
    const legacyAttempt = ride?.dispatchMessages.some(attempt => attempt.dispatchRecipient === "DRIVER" &&
      ["RESERVED","PENDING","SENT"].includes(attempt.status) && !attempt.body.includes("Trip controls & navigation:"));
    const link = ride && !legacyAttempt ? this.driverLink?.(ride) : "";
    const date = booking.pickupAt.toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" });
    const bodies = {
      driver: ride ? `${dispatchBrief({ ...ride, inquiry: { ...booking, pickupAt: booking.pickupAt.toISOString() } } as any)}\nChauffeur: ${ride.driverName || "not assigned"}\nVehicle: ${ride.vehicle?.name || "not assigned"}${link ? `\nTrip controls & navigation: ${link}` : ""}\nReply STOP to opt out or HELP for help.` : "",
      customer: `${SMS_BRAND}: Your chauffeur ${ride?.driverName || "not assigned"}${ride?.driverPhone ? ` (${ride.driverPhone})` : ""} and vehicle ${ride?.vehicle?.name || "not assigned"} are assigned for ${date}. Pickup: ${booking.pickup}. Drop-off: ${booking.destination}. Reply STOP to opt out or HELP for help.`,
    };
    for (const recipient of ["DRIVER", "CUSTOMER"] as const) {
      const prior = ride?.dispatchMessages.find(a => a.dispatchRecipient === recipient && ["RESERVED", "PENDING", "SENT"].includes(a.status));
      const key = recipient === "DRIVER" ? "driver" : "customer";
      // Rebranding alone must not change a provider reservation or resend SMS.
      if (prior && prior.body.replace(/^Allan Limousine(?=[: —])/, SMS_BRAND) === bodies[key]) bodies[key] = prior.body;
    }
    return bodies;
  }

  private changedAfterReservation(booking: Booking) {
    const bodies = this.bodies(booking);
    return booking.ride?.dispatchMessages.some(attempt => attempt.dispatchRecipient &&
      ["RESERVED", "PENDING", "SENT"].includes(attempt.status) &&
      (!samePhone(attempt.toPhone, attempt.dispatchRecipient === "DRIVER" ? booking.ride!.driverPhone || "" : booking.phone) ||
        attempt.body !== (attempt.dispatchRecipient === "DRIVER" ? bodies.driver : bodies.customer)));
  }

  private preview(booking: Booking, recipient: "DRIVER" | "CUSTOMER", body: string, skipReason: string | null): WizardSmsPreview {
    const attempt = this.chosenAttempt(booking, recipient);
    return {
      recipient, toPhone: attempt?.toPhone || (recipient === "DRIVER" ? booking.ride?.driverPhone || "" : booking.phone),
      body: attempt?.body || body,
      status: attempt?.status === "SENT" ? "SENT" : attempt?.status === "PENDING" ? "PENDING" : skipReason ? "SKIPPED" : (attempt?.status as WizardSmsPreview["status"]) || "NOT_STARTED",
      attemptId: attempt?.id || null, providerMessageId: attempt?.providerMessageId || null,
      deliveryStatus: attempt?.deliveryStatus || null, errorMessage: skipReason || attempt?.errorMessage || null,
    };
  }

  async snapshot(id: string): Promise<DispatchWizardSnapshot> {
    const booking = await this.record(id);
    const ride = booking.ride;
    const consent = bookingHasSmsConsent(booking.inquiryNotes, booking.phone);
    const [drivers, vehicles, busyRides, customerStop, driverStop] = await Promise.all([
      this.db.chauffeur.findMany({ where: { active: true }, include: { fleetVehicle: true }, orderBy: { name: "asc" } }),
      this.db.fleetVehicle.findMany({ where: { active: true }, include: { chauffeur: { select: { id: true } } }, orderBy: { name: "asc" } }),
      this.db.ride.findMany({ where: { status: { in: activeRideStatuses }, inquiryId: { not: id } }, select: { driverId: true, driverPhone: true, vehicleId: true } }),
      consent ? this.optedOut(booking.phone) : false,
      ride?.driverPhone ? this.optedOut(ride.driverPhone) : false,
    ]);
    const bodies = this.bodies(booking);
    const messages = {
      driver: this.preview(booking, "DRIVER", bodies.driver, null),
      customer: this.preview(booking, "CUSTOMER", bodies.customer, !consent ? "Client has not opted in to SMS." : customerStop ? "Client has opted out with STOP." : null),
    };
    const assigned = this.assigned(booking);
    const changed = this.changedAfterReservation(booking);
    const completed = booking.dispatchStep === 4 && booking.dispatchStatus === "DISPATCHED" ||
      assigned && !changed && messages.driver.status === "SENT" && ["SENT", "SKIPPED"].includes(messages.customer.status);
    const started = ride?.dispatchMessages.some(item => ["SENT", "PENDING", "RESERVED"].includes(item.status));
    const pending = ride?.dispatchMessages.some(item => item.status === "PENDING");
    let blocked: string | null = null;
    try { this.mutable(booking); } catch (error) { blocked = (error as Error).message; }
    if (pending && !completed) blocked = "An SMS outcome is uncertain. Reconcile the pending attempt before continuing.";
    else if (changed) blocked = "The reservation or assignment changed after notifications started. Review the existing dispatch in trip controls; automatic resending is blocked.";
    else if (driverStop && messages.driver.status !== "SENT") blocked = "This chauffeur has opted out of SMS. Resolve that opt-out or choose another chauffeur before dispatch.";
    else if (started && !assigned && !blocked) blocked = "The saved assignment is no longer active. Restore its chauffeur/vehicle before continuing; notifications already started.";
    if (completed && !changed) blocked = null;
    // Heal persisted workflow progress when an existing reconciliation proves acceptance.
    if (completed && booking.dispatchStep !== 4) {
      await this.db.inquiry.updateMany({
        where: { id, dispatchVersion: booking.dispatchVersion },
        data: { dispatchStep: 4, dispatchStatus: "DISPATCHED", dispatchVersion: { increment: 1 } },
      });
      return this.snapshot(id);
    }
    return {
      booking: {
        id, fullName: booking.fullName, phone: booking.phone, pickup: booking.pickup, destination: booking.destination,
        pickupAt: booking.pickupAt.toISOString(), vehicleClass: booking.rateTier || "Not specified",
        status: booking.status, dispatchStatus: completed ? "DISPATCHED" : booking.dispatchStatus,
        reviewedAt: booking.dispatchReviewedAt?.toISOString() || null, smsConsent: consent,
      },
      version: booking.dispatchVersion,
      step: completed ? 4 : assigned || started ? 3 : booking.dispatchReviewedAt ? 2 : 1,
      completed, blocked,
      drivers: drivers.map(driver => {
        const driverBusy = busyRides.some(other => other.driverId === driver.id || (other.driverPhone && samePhone(other.driverPhone, driver.phone)));
        const currentDriverBusy = Boolean(ride && activeRideStatuses.includes(ride.status) &&
          (ride.driverId === driver.id || (ride.driverPhone && samePhone(ride.driverPhone, driver.phone))));
        const vehicleBusy = Boolean(driver.fleetVehicle && busyRides.some(other => other.vehicleId === driver.fleetVehicle!.id));
        return {
          id: driver.id, name: driver.name, phone: driver.phone,
          fleetVehicleId: driver.fleetVehicleId,
          vehicleName: driver.fleetVehicle?.name || null,
          vehicleCategory: driver.fleetVehicle?.category || null,
          available: Boolean(driver.fleetVehicle?.active) && !driverBusy && !vehicleBusy,
          pairable: !driverBusy && !currentDriverBusy && !driver.fleetVehicleId,
        };
      }),
      vehicles: vehicles.map(vehicle => ({
        id: vehicle.id, name: vehicle.name, category: vehicle.category,
        pairedToDriverId: vehicle.chauffeur?.id || null,
        available: !busyRides.some(other => other.vehicleId === vehicle.id),
        pairable: !vehicle.chauffeur && !busyRides.some(other => other.vehicleId === vehicle.id) &&
          !(ride?.vehicleId === vehicle.id && activeRideStatuses.includes(ride.status)),
      })),
      assignment: {
        rideId: ride?.id || null, driverId: ride?.driverId || null, driverName: ride?.driverName || null,
        driverPhone: ride?.driverPhone || null, vehicleId: ride?.vehicleId || null, vehicleName: ride?.vehicle?.name || null,
      },
      messages,
    };
  }

  private async compareAndAdvance(db: Prisma.TransactionClient, booking: Booking, version: number, data: Prisma.InquiryUpdateManyMutationInput) {
    if (booking.dispatchVersion !== version) conflict("Another dispatcher changed this booking. Reload and review the saved progress.");
    const result = await db.inquiry.updateMany({
      where: { id: booking.id, dispatchVersion: version },
      data: { ...data, dispatchVersion: { increment: 1 } },
    });
    if (!result.count) conflict("Another dispatcher changed this booking. Reload and review the saved progress.");
  }

  async review(id: string, version: number, actor: Actor) {
    await this.db.$transaction(async db => {
      const booking = await this.record(id, db);
      this.mutable(booking);
      if (booking.dispatchReviewedAt || this.assigned(booking)) return;
      await this.compareAndAdvance(db, booking, version, { dispatchStep: 2, dispatchStatus: "REVIEWED", dispatchReviewedAt: new Date() });
      await db.inquiryNote.create({ data: { inquiryId: id, authorId: actor.id, authorName: actor.name, body: "Dispatch wizard: reservation details reviewed." } });
    }, { isolationLevel: "Serializable" });
    return this.snapshot(id);
  }

  async assign(id: string, version: number, driverId: string, actor: Actor, expectedVehicleId?: string) {
    await this.db.$transaction(async db => {
      const booking = await this.record(id, db);
      this.mutable(booking);
      if (!booking.dispatchReviewedAt && !this.assigned(booking)) conflict("Review the reservation details before assigning a chauffeur.");
      if (booking.ride?.dispatchMessages.some(item => ["PENDING", "RESERVED", "SENT"].includes(item.status))) {
        conflict("SMS dispatch has already started. The saved assignment cannot be changed in this wizard.");
      }
      const driver = await db.chauffeur.findUnique({ where: { id: driverId }, include: { fleetVehicle: true } });
      if (!driver?.active) conflict("Choose an active chauffeur.");
      const vehicle = driver.fleetVehicle;
      if (!vehicle?.active) conflict("This chauffeur needs an active paired vehicle before dispatch.");
      if (expectedVehicleId && expectedVehicleId !== vehicle.id) {
        conflict("The selected vehicle does not match this chauffeur's fixed pairing. Refresh before assigning.");
      }
      const busy = await db.ride.findMany({
        where: { status: { in: activeRideStatuses }, inquiryId: { not: id } },
        select: { vehicleId: true, driverId: true, driverPhone: true },
      });
      if (busy.some(item => item.vehicleId === vehicle.id || item.driverId === driverId || (item.driverPhone && samePhone(item.driverPhone, driver.phone)))) {
        conflict("This chauffeur or vehicle is already assigned to another active ride.");
      }
      const seats = Math.max(0, ...(vehicle.passengers.match(/\d+/g) || []).map(Number));
      if (!seats || seats < booking.passengers) conflict("This vehicle does not have enough configured passenger seats.");
      await this.compareAndAdvance(db, booking, version, { dispatchStep: 3, dispatchStatus: "ASSIGNED", status: "CONFIRMED" });
      const assignment = { driverId, driverName: driver.name, driverPhone: phone(driver.phone), vehicleId: vehicle.id, status: "ASSIGNED" };
      await db.ride.upsert({
        where: { inquiryId: id },
        create: { ...assignment, inquiryId: id, quoteCents: booking.estimatedFareCents || 0 },
        update: { ...assignment, driverAccessNonce:null, driverAccessTokenHash:null, driverAccessExpiresAt:null, driverAccessAssignment:null },
      });
      await db.inquiryNote.create({ data: { inquiryId: id, authorId: actor.id, authorName: actor.name, body: `Dispatch wizard: assigned ${driver.name} and ${vehicle.name}. No SMS sent at assignment.` } });
    }, { isolationLevel: "Serializable" });
    return this.snapshot(id);
  }

  /** Reserve both recipients atomically; RESERVED is proof no provider call has started. */
  private async reserve(id: string, version: number, actor: Actor) {
    const snapshot = await this.snapshot(id);
    if (snapshot.completed) return { version: snapshot.version, attempts: [] as Attempt[] };
    if (snapshot.blocked) conflict(snapshot.blocked);
    return this.db.$transaction(async db => {
      const booking = await this.record(id, db);
      this.mutable(booking);
      if (!this.assigned(booking)) conflict("Save a chauffeur and active vehicle assignment before sending SMS.");
      if (this.changedAfterReservation(booking)) conflict("The saved reservation changed after notifications started. Automatic resending is blocked.");
      if (booking.ride!.dispatchMessages.some(item => item.status === "PENDING")) conflict("A prior SMS still needs reconciliation. Do not resend.");
      await this.compareAndAdvance(db, booking, version, { dispatchStep: 3, dispatchStatus: "DISPATCHING" });
      const bodies = this.bodies(booking);
      const attempts: Attempt[] = [];
      for (const recipient of ["DRIVER", "CUSTOMER"] as const) {
        const prior = this.chosenAttempt(booking, recipient);
        if (prior?.status === "SENT") continue;
        const skip = recipient === "CUSTOMER" && snapshot.messages.customer.status === "SKIPPED";
        const destination = skip ? booking.phone : phone(recipient === "DRIVER" ? booking.ride!.driverPhone! : booking.phone);
        if (prior?.status === "RESERVED") { attempts.push(prior); continue; }
        const body = recipient === "DRIVER" ? bodies.driver : bodies.customer;
        if (!skip && (body.length < 20 || body.length > 1600)) throw new DispatchWizardError(422, "SMS preview must contain between 20 and 1,600 characters. Shorten the reservation notes or addresses.");
        if (prior?.status === "SKIPPED" && skip) continue;
        attempts.push(await db.dispatchMessage.create({
          data: { rideId: booking.ride!.id, dispatchRecipient: recipient, adminId: actor.id, adminName: actor.name, toPhone: destination, body, status: skip ? "SKIPPED" : "RESERVED", errorMessage: skip ? snapshot.messages.customer.errorMessage : null },
        }));
      }
      return { version: version + 1, attempts };
    }, { isolationLevel: "Serializable" });
  }

  private async begin(id: string, version: number, attempt: Attempt) {
    return this.db.$transaction(async db => {
      const booking = await this.record(id, db);
      this.mutable(booking);
      if (!this.assigned(booking)) conflict("The saved chauffeur/vehicle assignment is no longer active.");
      if (this.changedAfterReservation(booking)) conflict("The saved reservation changed before submission. No additional SMS was sent.");
      if (booking.dispatchVersion !== version) conflict("A newer dispatcher owns this workflow. Refresh before continuing.");
      // Fence a superseded worker before any provider call.
      const fence = await db.inquiry.updateMany({ where: { id, dispatchVersion: version }, data: { dispatchStatus: "DISPATCHING" } });
      if (!fence.count) conflict("A newer dispatcher owns this workflow.");
      if (this.chosenAttempt(booking, attempt.dispatchRecipient as "DRIVER" | "CUSTOMER")?.status === "SENT") return false;
      if (booking.ride!.dispatchMessages.some(item => item.status === "PENDING")) conflict("Another SMS is pending reconciliation.");
      const changed = await db.dispatchMessage.updateMany({ where: { id: attempt.id, status: "RESERVED" }, data: { status: "PENDING" } });
      return Boolean(changed.count);
    }, { isolationLevel: "Serializable" });
  }

  private async pause(id: string, version: number, status: string) {
    await this.db.inquiry.updateMany({
      where: { id, dispatchVersion: version },
      data: { dispatchStep: 3, dispatchStatus: status, dispatchVersion: { increment: 1 } },
    });
  }

  async dispatch(id: string, version: number, actor: Actor) {
    const reserved = await this.reserve(id, version, actor);
    for (const attempt of reserved.attempts) {
      if (attempt.status === "SKIPPED") continue;
      // Recheck STOP immediately before submission, not just when the preview loaded.
      if (attempt.dispatchRecipient === "CUSTOMER" && await this.optedOut(attempt.toPhone)) {
        await this.db.dispatchMessage.updateMany({ where: { id: attempt.id, status: "RESERVED" }, data: { status: "SKIPPED", errorMessage: "Client has opted out with STOP." } });
        continue;
      }
      if (!await this.begin(id, reserved.version, attempt)) continue;
      let accepted: Awaited<ReturnType<SendSms>>;
      try {
        accepted = await this.sendSms(attempt.toPhone, attempt.body);
      } catch (error) {
        if (error instanceof TwilioRequestError && error.definitivelyRejected) {
          await this.db.dispatchMessage.updateMany({
            where: { id: attempt.id, status: "PENDING" },
            data: { status: "FAILED", errorMessage: error.message },
          });
          await this.pause(id, reserved.version, "DISPATCH_FAILED");
        } else {
          // A transport failure might occur AFTER acceptance. Never unlock the attempt.
          await this.pause(id, reserved.version, "NEEDS_RECONCILIATION");
        }
        return this.snapshot(id);
      }
      if (!accepted.providerMessageId) {
        await this.pause(id, reserved.version, "NEEDS_RECONCILIATION");
        return this.snapshot(id);
      }
      try {
        const saved = await this.db.dispatchMessage.updateMany({
          where: { id: attempt.id, status: "PENDING" },
          data: { status: "SENT", providerMessageId: accepted.providerMessageId, providerStatus: accepted.providerStatus, deliveryStatus: accepted.providerStatus },
        });
        if (!saved.count) throw new Error("SMS audit update was not claimed.");
      } catch {
        // The provider accepted this SMS; an audit write failure is NOT a retryable send failure.
        await this.pause(id, reserved.version, "NEEDS_RECONCILIATION");
        throw new DispatchWizardError(502, "Twilio accepted a message but its audit write failed. Reconcile before retrying.");
      }
    }
    const snapshot = await this.snapshot(id);
    if (!snapshot.completed) await this.pause(id, reserved.version, "DISPATCH_FAILED");
    return this.snapshot(id);
  }
}
