import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const email = process.env.ADMIN_EMAIL || "admin@allanlimousine.com";
  if (!password || password === "change-this-before-production") {
    throw new Error("Set ADMIN_BOOTSTRAP_PASSWORD to a strong, non-default password before seeding.");
  }
  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, name: "ALLAN Administrator", passwordHash: await bcrypt.hash(password, 12), role: "SUPER_ADMIN" },
  });
  console.log(`Admin initialized for ${email}.`);
}

main().finally(() => prisma.$disconnect());