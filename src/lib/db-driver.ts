import type { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

/**
 * How the Prisma clients (app and catalog) talk to Postgres, from DATABASE_DRIVER:
 *
 * - unset or "prisma" (default): Prisma's own engine. Through Supabase's
 *   transaction pooler it runs in pgbouncer mode, which wraps every query in
 *   BEGIN / DEALLOCATE ALL / prepare / execute / COMMIT — five round trips.
 * - "pg": node-postgres through @prisma/adapter-pg. It sends each query as one
 *   unnamed statement (one round trip) and keeps no prepared statements on the
 *   server, so it is safe on the transaction pooler.
 *
 * Both use the same connection cap per client (connection_limit). Rolling back
 * is unsetting DATABASE_DRIVER and redeploying; nothing else depends on it.
 */
export type DatabaseDriver = "prisma" | "pg";

export function databaseDriver(env: string | undefined = process.env.DATABASE_DRIVER): DatabaseDriver {
  const value = env?.trim().toLowerCase();
  if (!value || value === "prisma") return "prisma";
  if (value === "pg") return "pg";
  throw new Error(`DATABASE_DRIVER must be "prisma" or "pg", not "${env}"`);
}

/** Idle connections close after this, so a quiet instance holds none open at the pooler. */
const IDLE_TIMEOUT_MS = 10_000;
/** Matches the engine's default wait for a connection from its pool. */
const CONNECTION_TIMEOUT_MS = 10_000;

/** node-postgres settings for a Prisma-style database URL, with the same connection cap. */
export function pgPoolConfig(url: string, defaultMax: number): PoolConfig {
  const u = new URL(url);
  const limit = Number(u.searchParams.get("connection_limit"));
  const sslmode = u.searchParams.get("sslmode");
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    max: Number.isInteger(limit) && limit > 0 ? limit : defaultMax,
    // sslmode=require means encrypted without checking the certificate, as the
    // engine treats it (Supabase's CA isn't in Node's store). verify-ca /
    // verify-full check it.
    ssl:
      !sslmode || sslmode === "disable"
        ? undefined
        : { rejectUnauthorized: sslmode === "verify-ca" || sslmode === "verify-full" },
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}

/**
 * The PrismaClient options that pick the driver for `url`. `defaultMax` is the
 * connection cap when the URL doesn't set connection_limit.
 */
export function prismaDriverOptions(
  url: string | undefined,
  defaultMax: number
): { datasources?: { db: { url: string } }; adapter?: PrismaPg } {
  if (!url) return {};
  if (databaseDriver() !== "pg") return { datasources: { db: { url } } };

  // Loaded only here, so the default engine never loads node-postgres. The
  // window check is also what keeps these server-only modules out of browser
  // bundles: some client components import modules that import the database
  // client for their constants (e.g. board-jobs.ts), and Next drops this
  // branch, requires included, from those bundles.
  if (typeof window === "undefined") {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Pool } = require("pg") as typeof import("pg");
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    const { attachDatabasePool } = require("@vercel/functions") as typeof import("@vercel/functions");
    /* eslint-enable @typescript-eslint/no-require-imports */

    const pool = new Pool(pgPoolConfig(url, defaultMax));
    // A connection the pooler drops while idle must not crash the process; the
    // pool replaces it on the next query.
    pool.on("error", (error) => {
      console.error("[db] idle database connection failed:", error.message);
    });
    // With Fluid compute, keeps the instance alive until idle connections close.
    attachDatabasePool(pool);
    return { adapter: new PrismaPg(pool) };
  }
  return {};
}
