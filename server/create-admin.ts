import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const email = process.argv[2] || await rl.question("Admin email: ");
const password = process.argv[3] || await rl.question("Admin password: ");
rl.close();
if (password.length < 12 || password === "change-this-before-production") {
  throw new Error("Admin passwords must be at least 12 characters and cannot use the documented placeholder.");
}

if (!process.env.DATABASE_URL) {
  console.log(`Set DATABASE_URL, then run again to create ${email}.`);
  process.exit(0);
}

const prisma = new PrismaClient();
await prisma.adminUser.upsert({
  where: { email },
  update: { passwordHash: await bcrypt.hash(password, 12), active: true },
  create: { email, name: "ALLAN Administrator", passwordHash: await bcrypt.hash(password, 12), role: "SUPER_ADMIN" },
});
console.log(`Super-admin ${email} is ready.`);
await prisma.$disconnect();