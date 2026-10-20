/**
 * Soft-merging an approved consolidation plan, against a real database:
 * the fingerprint gate, what changes and what doesn't, matching afterwards,
 * admin guards, and an exact revert. Works on one throwaway brand only.
 *
 *   npm run test:catalog:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS helper shared with the build scripts
const { loadDotEnv } = require("../scripts/db-url-diagnostics");

const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";

type CatalogPrisma = typeof import("./lib/db")["catalogPrisma"];
let db: CatalogPrisma;
let merge: typeof import("./lib/soft-merge");
let match: typeof import("./lib/match");
let guard: typeof import("../src/lib/catalog-merge-guard");

const RUN = Date.now().toString(36);
const BRAND = `Zzm${RUN}`;
let brandId: string;
const ids: Record<string, string> = {};
const batches: string[] = [];

/** Every field a merge or revert could touch, for every test row. */
async function snapshot() {
  const rows = await db.catalogBike.findMany({
    where: { brandId },
    select: { id: true, yearStart: true, yearEnd: true, updatedAt: true, mergedIntoId: true, mergedAt: true, mergeBatchId: true, _count: { select: { components: true } } },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), mergedAt: r.mergedAt?.toISOString() ?? null }));
}
const scoped = () => ({ brandIds: [brandId] });

describe("catalog soft merge", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  let original: Awaited<ReturnType<typeof snapshot>>;
  let originalHash: string;

  before(async () => {
    loadDotEnv();
    process.env.CATALOG_DATABASE_URL ||= process.env.DATABASE_URL;
    const url = process.env.CATALOG_DATABASE_URL ?? "";
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.includes(PRODUCTION_REF) || process.env.VERCEL_ENV === "production") {
      throw new Error("Refusing to run DB tests against production");
    }
    ({ catalogPrisma: db } = await import("./lib/db"));
    merge = await import("./lib/soft-merge");
    match = await import("./lib/match");
    guard = await import("../src/lib/catalog-merge-guard");

    brandId = (await db.catalogBrand.create({ data: { name: BRAND, slug: BRAND.toLowerCase() } })).id;
    const make = async (key: string, model: string, year: number, parts: Record<string, string>, span: string) => {
      const row = await db.catalogBike.create({
        data: {
          brandId, model, yearStart: year, yearEnd: year, externalKey: `${RUN}-${key}`, specStatus: "APPROXIMATE", confidence: 0.6, category: "Mountain",
          components: {
            create: Object.entries(parts).map(([slot, value], i) => ({
              slot: slot as never, label: slot, value, detail: `Shared build sheet for ${span}`, sortOrder: i, source: "APPROXIMATE",
            })),
          },
        },
      });
      ids[key] = row.id;
    };
    const trail = { FRAME_MATERIAL: "Aluminum", REAR_DERAILLEUR: "Shimano Deore", BRAKES: "Tektro hydraulic" };
    for (const y of [2018, 2019, 2020]) await make(`trail-${y}`, "Trail 7", y, trail, "2018–2020");
    const road = { FRAME_MATERIAL: "Steel", REAR_DERAILLEUR: "Shimano 105" };
    for (const y of [2015, 2016]) await make(`road-${y}`, "Road 3", y, road, "2015–2016");
    // A different template the year after: must stay its own row.
    await make("road-2017", "Road 3", 2017, { FRAME_MATERIAL: "Aluminum", REAR_DERAILLEUR: "Shimano Tiagra" }, "2017–2017");

    original = await snapshot();
    originalHash = (await merge.currentPlan(db, scoped())).hash;
  });

  after(async () => {
    if (!db) return;
    await db.catalogMergeBatch.deleteMany({ where: { id: { in: batches } } });
    await db.catalogBike.updateMany({ where: { brandId }, data: { mergedIntoId: null } });
    await db.catalogBrand.deleteMany({ where: { id: brandId } });
    await db.$disconnect();
  });

  it("proposes the template merges and nothing else", async () => {
    const plan = await merge.currentPlan(db, scoped());
    assert.equal(plan.merges.length, 2);
    const trail = plan.merges.find((m) => m.survivorId === ids["trail-2018"])!;
    assert.deepEqual(trail.memberIds.sort(), [ids["trail-2019"], ids["trail-2020"]].sort());
    assert.ok(!plan.merges.some((m) => m.memberIds.includes(ids["road-2017"]) || m.survivorId === ids["road-2017"]));
  });

  it("a dry run checks the fingerprint and changes nothing", async () => {
    const r = await merge.applyConsolidationPlan(db, { expectedHash: originalHash, approvedBy: "test", dryRun: true, ...scoped() });
    assert.deepEqual([r.merges, r.rowsMarkedMerged, r.batchId], [2, 3, null]);
    assert.deepEqual(await snapshot(), original);
  });

  it("refuses a plan whose fingerprint doesn't match, and changes nothing", async () => {
    await assert.rejects(
      merge.applyConsolidationPlan(db, { expectedHash: "0".repeat(64), approvedBy: "test", ...scoped() }),
      merge.StalePlanError
    );
    assert.deepEqual(await snapshot(), original);
  });

  it("applies: survivors widen, other rows are marked merged and otherwise untouched", async () => {
    const r = await merge.applyConsolidationPlan(db, { expectedHash: originalHash, approvedBy: "test", ...scoped() });
    batches.push(r.batchId!);
    const after = new Map((await snapshot()).map((s) => [s.id, s]));
    const before = new Map(original.map((s) => [s.id, s]));
    assert.equal(after.get(ids["trail-2018"])!.yearEnd, 2020, "survivor span widened");
    assert.equal(after.get(ids["road-2015"])!.yearEnd, 2016);
    for (const k of ["trail-2019", "trail-2020"]) {
      const row = after.get(ids[k])!;
      assert.equal(row.mergedIntoId, ids["trail-2018"]);
      assert.equal(row.mergeBatchId, r.batchId);
      assert.equal(row.updatedAt, before.get(ids[k])!.updatedAt, "merged row keeps its own updatedAt");
      assert.equal(row._count.components, 3, "merged row keeps its parts");
      assert.equal(row.yearStart, before.get(ids[k])!.yearStart);
    }
    assert.equal(after.get(ids["road-2017"])!.mergedIntoId, null, "different template untouched");
    assert.deepEqual(after.get(ids["road-2017"]), before.get(ids["road-2017"]));
    assert.equal((await merge.currentPlan(db, scoped())).merges.length, 0, "a re-run proposes nothing more");
  });

  it("matching sees only the survivor for a merged year", async () => {
    // Approximate rows are offered as candidates rather than picked
    // automatically (existing policy); either way, only the survivor appears.
    const m = await match.matchCatalogRow(BRAND, "Trail 7", 2019);
    const seen = m.ok ? [m.bike.id] : (m as { candidates?: { id: string }[] }).candidates?.map((c) => c.id) ?? [];
    assert.deepEqual(seen, [ids["trail-2018"]], JSON.stringify(m).slice(0, 200));
  });

  it("admin edits to merged rows, and deleting a survivor, are refused", async () => {
    assert.equal((await guard.catalogMergeConflict(ids["trail-2019"], "edit"))?.status, 409);
    assert.equal((await guard.catalogMergeConflict(ids["trail-2019"], "verify"))?.status, 409);
    assert.equal((await guard.catalogMergeConflict(ids["trail-2018"], "delete"))?.status, 409);
    assert.equal(await guard.catalogMergeConflict(ids["trail-2018"], "edit"), null, "the survivor itself is editable");
  });

  it("the old approval can't be applied twice", async () => {
    await assert.rejects(
      merge.applyConsolidationPlan(db, { expectedHash: originalHash, approvedBy: "test", ...scoped() }),
      merge.StalePlanError
    );
  });

  it("revert restores every row exactly, including timestamps", async () => {
    const r = await merge.revertMergeBatch(db, { batchId: batches[0], revertedBy: "test" });
    assert.equal(r.rowsRestored, 3);
    assert.deepEqual(await snapshot(), original);
    assert.equal((await merge.currentPlan(db, scoped())).hash, originalHash, "the same plan, same fingerprint, again");
    await assert.rejects(merge.revertMergeBatch(db, { batchId: batches[0], revertedBy: "test" }), merge.RevertConflictError);
  });

  it("revert refuses, changing nothing, if a merged group was edited afterwards", async () => {
    const r = await merge.applyConsolidationPlan(db, { expectedHash: originalHash, approvedBy: "test", ...scoped() });
    batches.push(r.batchId!);
    await db.catalogBike.update({ where: { id: ids["road-2015"] }, data: { verificationNote: "edited after merge" } });
    const before = await snapshot();
    await assert.rejects(merge.revertMergeBatch(db, { batchId: r.batchId!, revertedBy: "test" }), merge.RevertConflictError);
    assert.deepEqual(await snapshot(), before, "no partial revert");
  });
});
