/**
 * Calls real API route handlers outside Next, as a signed-in staff member of a
 * throwaway test shop, against the database in DATABASE_URL (staging only —
 * see assertNotProduction). For the *.db.test.ts route tests.
 *
 * Run with scripts/tsconfig.route-tests.json: it maps `react` to Next's
 * bundled React, which has the `cache` the shop lookup uses.
 */
import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS helper shared with the build scripts
const { loadDotEnv } = require("../../../scripts/db-url-diagnostics");

/** Documented in .env.example; the env var wins when set. */
const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "bikeops.co";

/** The DB loader only sets database variables; sessions also need the auth secret. */
function loadAuthSecret(): void {
  if (process.env.NEXTAUTH_SECRET) return;
  for (const file of [".env.local", ".env"]) {
    try {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .find((l) => l.startsWith("NEXTAUTH_SECRET="));
      if (line) {
        process.env.NEXTAUTH_SECRET = line.slice("NEXTAUTH_SECRET=".length).trim().replace(/^"|"$/g, "");
        return;
      }
    } catch {
      // file missing — try the next one
    }
  }
}

export function loadTestEnv(): void {
  loadDotEnv();
  loadAuthSecret();
  process.env.CATALOG_DATABASE_URL ||= process.env.DATABASE_URL;
  // No paid web lookups from route tests, whatever they schedule.
  process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "0";
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.includes(PRODUCTION_REF) || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run route tests against production");
  }
  if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is not set");
}

export type TestShop = { id: string; subdomain: string; host: string; userId: string; cookie: string };

type Prisma = typeof import("@/lib/db")["prisma"];

/** A shop with one staff user and a valid session cookie for it. */
export async function createTestShop(prisma: Prisma, subdomain: string): Promise<TestShop> {
  const shop = await prisma.shop.create({ data: { name: `Test ${subdomain}`, subdomain } });
  const user = await prisma.user.create({
    data: { shopId: shop.id, email: `${subdomain}@example.test`, passwordHash: "not-a-real-hash", name: `Staff ${subdomain}` },
  });
  const token = await encode({
    token: { id: user.id, shopId: shop.id, shopSubdomain: subdomain, email: user.email },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  return {
    id: shop.id,
    subdomain,
    host: `${subdomain}.${ROOT_DOMAIN}`,
    userId: user.id,
    cookie: `next-auth.session-token=${token}`,
  };
}

/** A request to `path` on `host`, signed in as `as` (or signed out). */
export function request(
  method: string,
  path: string,
  options: { host: string; as?: TestShop | null; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const headers: Record<string, string> = { host: options.host, ...options.headers };
  if (options.as) headers.cookie = [options.as.cookie, options.headers?.cookie].filter(Boolean).join("; ");
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://${options.host}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}
