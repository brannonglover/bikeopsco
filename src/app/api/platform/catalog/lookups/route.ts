import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { catalogPrisma, isCatalogConfigured } from "@/lib/bike-catalog-admin";
import { spendSummary } from "@/lib/catalog-lookup/spend";

export const dynamic = "force-dynamic";

/** Web lookup spend (against the soft daily cap) and the most recent lookups. */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  const [spend, lookups] = await Promise.all([
    spendSummary(7),
    catalogPrisma.catalogLookup.findMany({ orderBy: { updatedAt: "desc" }, take: 25 }),
  ]);
  const costs = await catalogPrisma.catalogLookupSpend.groupBy({
    by: ["lookupKey"],
    where: { lookupKey: { in: lookups.map((l) => l.key) } },
    _sum: { costUsd: true },
  });
  const costByKey = new Map(costs.map((c) => [c.lookupKey, c._sum.costUsd ?? 0]));

  return NextResponse.json({
    spend,
    lookups: lookups.map((l) => ({
      key: l.key,
      make: l.make,
      model: l.model,
      year: l.year,
      status: l.status,
      attempts: l.attempts,
      builds: l.catalogBikeIds.length,
      lineupConfirmed: l.configurationsComplete,
      lineupSourceUrl: l.lineupSourceUrl,
      message: l.message,
      nextAttemptAt: l.nextAttemptAt?.toISOString() ?? null,
      updatedAt: l.updatedAt.toISOString(),
      costUsd: costByKey.get(l.key) ?? 0,
    })),
  });
}
