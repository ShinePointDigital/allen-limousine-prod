import "dotenv/config";
import { spawnSync } from "node:child_process";
import { applicationDatabaseUrl } from "../server/database-config.js";

if (!process.argv.includes("--development-database")) {
  throw new Error("Development migration command requires the development-database guard.");
}
// This guard rejects a missing development DB or one equal to SHARED_DATABASE_URL.
if (!applicationDatabaseUrl()) throw new Error("Development database is not configured.");
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit" });
process.exit(result.status ?? 1);
