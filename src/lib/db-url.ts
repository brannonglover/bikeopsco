/**
 * Normalizes DATABASE_URL for Prisma + Supabase Supavisor transaction pooler.
 * Port 6543 does not support prepared statements; Prisma requires ?pgbouncer=true.
 * @see https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting
 */
export function normalizeDatabaseUrlForPrisma(
  raw: string | undefined
): string | undefined {
  if (!raw?.trim()) return raw;

  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.port !== "6543") return trimmed;

    let changed = false;
    if (parsed.searchParams.get("pgbouncer") !== "true") {
      parsed.searchParams.set("pgbouncer", "true");
      changed = true;
    }
    if (!parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
      changed = true;
    }
    // One connection per serverless instance; Supabase recommends starting low.
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", "1");
      changed = true;
    }
    return changed ? parsed.toString() : trimmed;
  } catch {
    return trimmed;
  }
}
