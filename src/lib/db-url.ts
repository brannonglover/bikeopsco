/**
 * Connections each Prisma client may open per function instance, unless the
 * URL sets connection_limit. With Fluid compute one instance serves many
 * requests at once, and a request reads several things side by side, so one
 * connection would queue all of them. The pooler multiplexes these onto its
 * own server pool; the cap that matters is its client limit (200 on
 * Nano/Micro compute) across all instances.
 */
export const DEFAULT_CONNECTION_LIMIT = { app: 5, catalog: 3 } as const;

/**
 * Normalizes DATABASE_URL for Prisma + Supabase Supavisor transaction pooler.
 * Port 6543 does not support prepared statements; Prisma requires ?pgbouncer=true
 * (without it, queries fail with "prepared statement \"s…\" does not exist").
 * @see https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting
 */
export function normalizeDatabaseUrlForPrisma(
  raw: string | undefined,
  options: { connectionLimit?: number } = {}
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
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", String(options.connectionLimit ?? DEFAULT_CONNECTION_LIMIT.app));
      changed = true;
    }
    return changed ? parsed.toString() : trimmed;
  } catch {
    return trimmed;
  }
}
