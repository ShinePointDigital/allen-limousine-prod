import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./store.js";

export const RESET_LIFETIME_MS = 30 * 60 * 1000;
export const RESET_COOLDOWN_MS = 60 * 1000;
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function issueAdminPasswordReset(email: string, database: PrismaClient = prisma, now = new Date()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await database.$transaction(async tx => {
        const user = await tx.adminUser.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, active: true } });
        if (!user?.active) return { kind: "unavailable" as const };
        const previous = await tx.adminPasswordReset.findUnique({ where: { userId: user.id } });
        if (previous && previous.createdAt.getTime() > now.getTime() - RESET_COOLDOWN_MS) return { kind: "cooldown" as const };
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(now.getTime() + RESET_LIFETIME_MS);
        const data = { tokenHash: hashToken(token), expiresAt, createdAt: now };
        await tx.adminPasswordReset.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
        return { kind: "issued" as const, token, email: user.email, expiresAt };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Unable to issue a reset link.");
}

export async function completeAdminPasswordReset(token: string, password: string, database: PrismaClient = prisma, now = new Date()) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 12 || password.length > 200) return false;
  const tokenHash = hashToken(token);
  const candidate = await database.adminPasswordReset.findUnique({ where: { tokenHash } });
  if (!candidate || candidate.expiresAt <= now) return false;
  const passwordHash = await bcrypt.hash(password, 12);
  return database.$transaction(async tx => {
    const reset = await tx.adminPasswordReset.findUnique({ where: { tokenHash } });
    if (!reset || reset.expiresAt <= now) return false;
    // A conditional delete claims the token: concurrent submissions cannot both succeed.
    const claimed = await tx.adminPasswordReset.deleteMany({ where: { tokenHash, expiresAt: { gt: now } } });
    if (claimed.count !== 1) return false;
    const changed = await tx.adminUser.updateMany({ where: { id: reset.userId, active: true }, data: { passwordHash } });
    if (changed.count !== 1) return false;
    await tx.adminSession.deleteMany({ where: { userId: reset.userId } });
    return true;
  });
}