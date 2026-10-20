import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "../generated/client";
import { analyzeConsolidation, type ProposedMerge } from "./consolidation";
import { planHash } from "./consolidation-report";
import { loadConsolidationRows } from "./consolidation-rows";

/**
 * Apply or revert an approved consolidation plan as a soft merge.
 *
 * Apply recomputes the plan from the live catalog with the same code the
 * read-only report uses, and refuses unless its fingerprint is exactly the
 * one that was approved — so a catalog that changed since the review can't
 * be merged on an old approval. Nothing is deleted or re-pointed: each
 * survivor's span widens and the other rows are marked merged into it. The
 * batch records every touched row's prior state, and revert restores it
 * exactly, refusing if anything was edited after the merge.
 */

type CatalogClient = PrismaClient;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 300_000, maxWait: 30_000 } as const;

export class StalePlanError extends Error {
  constructor(public expected: string, public actual: string) {
    super(`The catalog changed since this plan was reviewed (approved ${expected.slice(0, 12)}…, now ${actual.slice(0, 12)}…). Re-run the report and review again.`);
  }
}
export class NothingToApplyError extends Error {}
export class RevertConflictError extends Error {}

type RowPrior = { yearStart: number | null; yearEnd: number | null; updatedAt: string };
export type MergeBatchGroup = {
  survivorId: string;
  memberIds: string[];
  toYearEnd: number;
  /** The survivor's updatedAt right after the merge; revert refuses if it moved. */
  survivorUpdatedAtAfter: string;
  prior: Record<string, RowPrior>;
};

export type ApplyResult = {
  hash: string;
  merges: number;
  rowsMarkedMerged: number;
  batchId: string | null;
  dryRun: boolean;
};

async function lockCatalog(tx: Tx) {
  // Row locks on every catalog row: anyone editing a row waits until this
  // transaction ends, readers carry on. Unlike a table lock, this needs only
  // the column-level UPDATE rights the merge login has. A row inserted
  // meanwhile isn't in the recomputed plan, so it's simply left as it is.
  await tx.$queryRawUnsafe(`SELECT id FROM "bike_catalog"."CatalogBike" FOR UPDATE`);
}

/** The plan as the report would compute it now: merges, fingerprint, rows. */
export async function currentPlan(tx: Pick<CatalogClient, "catalogBike">, options: { brandIds?: string[] } = {}) {
  const rows = await loadConsolidationRows(tx, options);
  const analysis = analyzeConsolidation(rows);
  const merges: ProposedMerge[] = analysis.groups.flatMap((g) => g.merges);
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  return { merges, rowsById, hash: planHash(merges, rowsById) };
}

export async function applyConsolidationPlan(
  db: CatalogClient,
  options: { expectedHash: string; approvedBy: string; dryRun?: boolean; brandIds?: string[] }
): Promise<ApplyResult> {
  if (!options.approvedBy.trim()) throw new Error("approvedBy is required");
  return db.$transaction(async (tx) => {
    await lockCatalog(tx);
    const { merges, rowsById, hash } = await currentPlan(tx, { brandIds: options.brandIds });
    if (hash !== options.expectedHash) throw new StalePlanError(options.expectedHash, hash);
    if (merges.length === 0) throw new NothingToApplyError("This plan has no merges.");
    const rowsMarkedMerged = merges.reduce((n, m) => n + m.memberIds.length, 0);
    if (options.dryRun) return { hash, merges: merges.length, rowsMarkedMerged, batchId: null, dryRun: true };

    const batchId = randomUUID();
    const groups: MergeBatchGroup[] = [];
    for (const m of merges) {
      const ids = [m.survivorId, ...m.memberIds];
      const prior: Record<string, RowPrior> = {};
      for (const id of ids) {
        const r = rowsById.get(id)!;
        prior[id] = { yearStart: r.yearStart, yearEnd: r.yearEnd, updatedAt: r.updatedAt.toISOString() };
      }
      const toYearEnd = Math.max(...ids.map((id) => prior[id].yearEnd ?? prior[id].yearStart ?? -Infinity));
      if (!Number.isFinite(toYearEnd)) throw new Error(`Merge for ${m.survivorId} has no years`);

      const widened = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
        UPDATE "bike_catalog"."CatalogBike"
        SET "yearEnd" = ${toYearEnd}, "updatedAt" = now()
        WHERE id = ${m.survivorId} AND "mergedIntoId" IS NULL
        RETURNING "updatedAt"`;
      if (widened.length !== 1) throw new Error(`Survivor ${m.survivorId} is missing or already merged`);

      // Raw SQL so the merged rows keep their own updatedAt: only the merge
      // markers change, and revert can restore them exactly.
      const marked = await tx.$executeRaw`
        UPDATE "bike_catalog"."CatalogBike"
        SET "mergedIntoId" = ${m.survivorId}, "mergedAt" = now(), "mergeBatchId" = ${batchId}
        WHERE id = ANY(${m.memberIds}::text[]) AND "mergedIntoId" IS NULL`;
      if (marked !== m.memberIds.length) throw new Error(`Some rows merging into ${m.survivorId} were missing or already merged`);

      groups.push({
        survivorId: m.survivorId,
        memberIds: m.memberIds,
        toYearEnd,
        survivorUpdatedAtAfter: widened[0].updatedAt.toISOString(),
        prior,
      });
    }

    await tx.catalogMergeBatch.create({
      data: { id: batchId, planHash: hash, approvedBy: options.approvedBy.trim(), groups: groups as unknown as Prisma.InputJsonValue },
    });
    return { hash, merges: merges.length, rowsMarkedMerged, batchId, dryRun: false };
  }, TX_OPTIONS);
}

export async function revertMergeBatch(
  db: CatalogClient,
  options: { batchId: string; revertedBy: string }
): Promise<{ batchId: string; groups: number; rowsRestored: number }> {
  if (!options.revertedBy.trim()) throw new Error("revertedBy is required");
  return db.$transaction(async (tx) => {
    await lockCatalog(tx);
    const batch = await tx.catalogMergeBatch.findUnique({ where: { id: options.batchId } });
    if (!batch) throw new RevertConflictError(`No merge batch ${options.batchId}`);
    if (batch.revertedAt) throw new RevertConflictError(`Batch ${options.batchId} was already reverted`);
    const groups = batch.groups as unknown as MergeBatchGroup[];

    // Check everything first: a partial revert is never left behind.
    for (const g of groups) {
      const survivor = await tx.catalogBike.findUnique({
        where: { id: g.survivorId },
        select: { yearEnd: true, mergedIntoId: true, updatedAt: true },
      });
      if (!survivor || survivor.mergedIntoId || survivor.yearEnd !== g.toYearEnd || survivor.updatedAt.toISOString() !== g.survivorUpdatedAtAfter) {
        throw new RevertConflictError(`Row ${g.survivorId} was changed after the merge; revert it by hand or re-run the report.`);
      }
      const members = await tx.catalogBike.findMany({
        where: { id: { in: g.memberIds } },
        select: { id: true, mergedIntoId: true, mergeBatchId: true, updatedAt: true },
      });
      const intact = members.filter(
        (r) => r.mergedIntoId === g.survivorId && r.mergeBatchId === batch.id && r.updatedAt.toISOString() === g.prior[r.id]?.updatedAt
      );
      if (intact.length !== g.memberIds.length) {
        throw new RevertConflictError(`Rows merged into ${g.survivorId} were changed after the merge.`);
      }
    }

    let rowsRestored = 0;
    for (const g of groups) {
      const p = g.prior[g.survivorId];
      await tx.$executeRaw`
        UPDATE "bike_catalog"."CatalogBike"
        SET "yearEnd" = ${p.yearEnd}, "updatedAt" = ${new Date(p.updatedAt)}
        WHERE id = ${g.survivorId}`;
      rowsRestored += await tx.$executeRaw`
        UPDATE "bike_catalog"."CatalogBike"
        SET "mergedIntoId" = NULL, "mergedAt" = NULL, "mergeBatchId" = NULL
        WHERE id = ANY(${g.memberIds}::text[]) AND "mergeBatchId" = ${batch.id}`;
    }
    await tx.catalogMergeBatch.update({
      where: { id: batch.id },
      data: { revertedAt: new Date(), revertedBy: options.revertedBy.trim() },
    });
    return { batchId: batch.id, groups: groups.length, rowsRestored };
  }, TX_OPTIONS);
}
