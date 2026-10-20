import type { PrismaClient } from "../generated/client";
import type { ConsolidationRow } from "./consolidation";

type CatalogTx = Pick<PrismaClient, "catalogBike">;

/**
 * The catalog rows consolidation looks at: every row not already merged into
 * another. Shared by the read-only report and the merge tool, so the plan the
 * tool recomputes (and fingerprints) is exactly the plan the report showed.
 * `brandIds` narrows it for tests.
 */
export async function loadConsolidationRows(
  tx: CatalogTx,
  options: { brandIds?: string[] } = {}
): Promise<ConsolidationRow[]> {
  const bikes = await tx.catalogBike.findMany({
    where: { mergedIntoId: null, ...(options.brandIds ? { brandId: { in: options.brandIds } } : {}) },
    include: { brand: { select: { name: true } }, components: true },
    orderBy: [{ brandId: "asc" }, { model: "asc" }, { yearStart: "asc" }],
  });
  return bikes.map((b) => ({
    id: b.id,
    brandId: b.brandId,
    brandName: b.brand.name,
    model: b.model,
    family: b.family,
    category: b.category,
    subcategory: b.subcategory,
    yearStart: b.yearStart,
    yearEnd: b.yearEnd,
    specStatus: b.specStatus,
    verifiedAt: b.verifiedAt,
    verifiedBy: b.verifiedBy,
    sourceUrl: b.sourceUrl,
    externalKey: b.externalKey,
    updatedAt: b.updatedAt,
    components: b.components.map((c) => ({
      slot: c.slot,
      value: c.value,
      standard: c.standard,
      detail: c.detail,
      source: c.source,
      sourceUrl: c.sourceUrl,
      verifiedAt: c.verifiedAt,
      verifiedBy: c.verifiedBy,
    })),
  }));
}
