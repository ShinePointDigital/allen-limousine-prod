type DatabaseEnvironment = Record<string, string | undefined>;

/**
 * Application traffic can share production data across Replit and Vercel.
 * Prisma's migration/seed configuration still uses the managed DATABASE_URL.
 * Node test workers must not inherit the application's production override.
 */
export function applicationDatabaseUrl(env: DatabaseEnvironment = process.env): string | undefined {
  const development = process.argv.includes("--development-database");
  const testing = env.NODE_ENV === "test" || Boolean(env.NODE_TEST_CONTEXT);
  if (testing || development) {
    if (development && env.NODE_ENV === "production") throw new Error("Development database mode cannot run in production.");
    if (env.DATABASE_URL && env.SHARED_DATABASE_URL === env.DATABASE_URL) {
      throw new Error("Refusing to run database tests against the shared production connection.");
    }
    if (development && !env.DATABASE_URL) throw new Error("A separate development database is required for preview.");
    return env.DATABASE_URL;
  }
  return env.SHARED_DATABASE_URL || env.DATABASE_URL;
}
