#!/usr/bin/env npx ts-node
/**
 * Apply or revert an approved catalog consolidation plan (soft merge).
 *
 *   npm run catalog:merge -- --plan <fingerprint> --approved-by "<name>"            # dry run
 *   npm run catalog:merge -- --plan <fingerprint> --approved-by "<name>" --apply    # writes
 *   npm run catalog:merge -- --revert <batchId> --by "<name>"                       # undo a batch
 *   npm run catalog:merge -- --status                                               # list batches
 *
 * The plan is recomputed from the live catalog and must match the approved
 * fingerprint exactly (see bike-catalog/lib/soft-merge.ts). Writing to the
 * production project also needs --production, so a wrong connection string
 * can't merge production by accident. The target database is printed first.
 */
import { catalogPrisma, isCatalogConfigured } from "./lib/db";
import { describeDatabase } from "./consolidation-report";
import { applyConsolidationPlan, currentPlan, revertMergeBatch, StalePlanError } from "./lib/soft-merge";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string) => process.argv.includes(flag);

async function main() {
  if (!isCatalogConfigured()) throw new Error("CATALOG_DATABASE_URL or DATABASE_URL must be set");
  const db = describeDatabase(process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL);
  console.log(`Catalog database: ${db.environment} (${db.host}, ${db.projectRef ?? "?"})`);
  const writing = has("--apply") || has("--revert");
  if (writing && db.environment === "production" && !has("--production")) {
    throw new Error("This is the production catalog. Add --production to confirm writing to it.");
  }

  if (has("--status")) {
    const batches = await catalogPrisma.catalogMergeBatch.findMany({ orderBy: { appliedAt: "desc" } });
    const { hash, merges } = await currentPlan(catalogPrisma);
    console.log(`Current plan: ${merges.length} merge(s), fingerprint ${hash}`);
    if (batches.length === 0) console.log("No merge batches.");
    for (const b of batches) {
      const groups = b.groups as Array<{ memberIds: string[] }>;
      console.log(
        `${b.id}  applied ${b.appliedAt.toISOString()} by ${b.approvedBy}  plan ${b.planHash.slice(0, 12)}…  ` +
          `${groups.length} merge(s), ${groups.reduce((n, g) => n + g.memberIds.length, 0)} row(s) merged` +
          (b.revertedAt ? `  — REVERTED ${b.revertedAt.toISOString()} by ${b.revertedBy}` : "")
      );
    }
    return;
  }

  const revertId = arg("--revert");
  if (revertId) {
    const by = arg("--by");
    if (!by) throw new Error('Add --by "<name>"');
    const r = await revertMergeBatch(catalogPrisma, { batchId: revertId, revertedBy: by });
    console.log(`Reverted batch ${r.batchId}: ${r.groups} merge(s) undone, ${r.rowsRestored} row(s) restored.`);
    return;
  }

  const plan = arg("--plan");
  const approvedBy = arg("--approved-by");
  if (!plan || !approvedBy) throw new Error('Add --plan <fingerprint> and --approved-by "<name>"');
  try {
    const r = await applyConsolidationPlan(catalogPrisma, { expectedHash: plan, approvedBy, dryRun: !has("--apply") });
    if (r.dryRun) {
      console.log(`Dry run: fingerprint matches. Would apply ${r.merges} merge(s), marking ${r.rowsMarkedMerged} row(s) merged. Nothing changed.`);
      console.log("Add --apply to write it.");
    } else {
      console.log(`Applied: ${r.merges} merge(s), ${r.rowsMarkedMerged} row(s) marked merged. Batch ${r.batchId}`);
      console.log(`Undo with: npm run catalog:merge -- --revert ${r.batchId} --by "<name>"`);
    }
  } catch (error) {
    if (error instanceof StalePlanError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => catalogPrisma.$disconnect());
