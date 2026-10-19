/**
 * The consolidation report against a real database: classifications,
 * references, and proof that it changes nothing.
 *
 *   npm run test:catalog:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS helper shared with the build scripts
const { loadDotEnv } = require("../scripts/db-url-diagnostics");

const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";

type Prisma = typeof import("@/lib/db")["prisma"];
type CatalogPrisma = typeof import("./lib/db")["catalogPrisma"];

let prisma: Prisma;
let catalogPrisma: CatalogPrisma;
let runConsolidationReport: typeof import("./consolidation-report")["runConsolidationReport"];

const RUN = Date.now().toString(36);
const BRAND = `Zzc${RUN}`;
const ids: Record<string, string> = {};
let customerId: string;
let jobId: string;
let outDir: string;

const FULL: Record<string, string> = {
  BOTTOM_BRACKET: "Shimano MT500 BB92",
  HEADSET: "Tapered 1-1/8 to 1.5",
  WHEEL_SIZE: '29"',
  BRAKES: "Shimano MT420 post mount",
  FORK: "Fox 34 Rhythm 140mm",
  CASSETTE: "Shimano XT M8100 10-51",
  AXLE: "Boost 110x15 / 148x12",
  REAR_DERAILLEUR: "Shimano XT M8100",
};

describe("consolidation report against a database", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadDotEnv();
    process.env.CATALOG_DATABASE_URL ||= process.env.DATABASE_URL;
    const url = process.env.DATABASE_URL ?? "";
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.includes(PRODUCTION_REF) || process.env.VERCEL_ENV === "production") {
      throw new Error("Refusing to run DB tests against production");
    }
    ({ prisma } = await import("@/lib/db"));
    ({ catalogPrisma } = await import("./lib/db"));
    ({ runConsolidationReport } = await import("./consolidation-report"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-report-"));

    const brand = await catalogPrisma.catalogBrand.create({ data: { name: BRAND, slug: BRAND.toLowerCase() } });
    const make = async (
      key: string,
      model: string,
      year: number,
      specStatus: "APPROXIMATE" | "SOURCED",
      parts: Record<string, string>,
      detail: string | null = null
    ) => {
      const row = await catalogPrisma.catalogBike.create({
        data: {
          brandId: brand.id,
          model,
          yearStart: year,
          yearEnd: year,
          externalKey: `${RUN}-${key}`,
          specStatus,
          confidence: 0.7,
          category: "Mountain",
          components: {
            create: Object.entries(parts).map(([slot, value], i) => ({
              slot: slot as never,
              label: slot,
              value,
              detail,
              sortOrder: i,
              source: specStatus === "APPROXIMATE" ? "APPROXIMATE" : "THIRD_PARTY",
              sourceUrl: specStatus === "APPROXIMATE" ? null : "https://example.com/spec",
            })),
          },
        },
      });
      ids[key] = row.id;
    };

    const template = { FRAME_MATERIAL: "Aluminum", REAR_DERAILLEUR: "Shimano Deore / LX" };
    for (const y of [2018, 2019, 2020]) {
      await make(`t7-${y}`, "Trail 7", y, "APPROXIMATE", template, "Shared build sheet for 2018–2020");
    }
    await make("t9-2019", "Trail 9", 2019, "SOURCED", FULL);
    await make("t9-2020", "Trail 9", 2020, "SOURCED", FULL);
    await make("t9-2021", "Trail 9", 2021, "SOURCED", { ...FULL, BOTTOM_BRACKET: "Threaded BSA 73mm" });
    await make("t9pro-2019", "Trail 9 Pro", 2019, "SOURCED", FULL);
    const { BOTTOM_BRACKET: _bb, ...noBB } = FULL;
    await make("t5-2019", "Trail 5", 2019, "SOURCED", noBB);
    await make("t5-2020", "Trail 5", 2020, "SOURCED", noBB);

    // Shop references: an active job on the 2020 Trail 9, a confirmed customer bike on 2019.
    const shopId = (await prisma.shop.findFirstOrThrow({ select: { id: true } })).id;
    customerId = (await prisma.customer.create({ data: { shopId, firstName: `Test ${BRAND}` } })).id;
    const bike = await prisma.bike.create({
      data: {
        shopId,
        customerId,
        make: BRAND,
        model: "Trail 9",
        year: 2019,
        catalogBikeId: ids["t9-2019"],
        catalogConfirmedAt: new Date(),
      },
    });
    jobId = (await prisma.job.create({ data: { shopId, customerId, bikeMake: BRAND, bikeModel: "Trail 9", stage: "WORKING_ON" } })).id;
    await prisma.jobBike.create({
      data: { shopId, jobId, make: BRAND, model: "Trail 9", year: 2020, bikeId: bike.id, catalogBikeId: ids["t9-2020"], sortOrder: 0 },
    });
  });

  after(async () => {
    if (!prisma) return;
    if (jobId) await prisma.job.delete({ where: { id: jobId } }).catch(() => {});
    if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    await catalogPrisma.catalogBrand.deleteMany({ where: { name: BRAND } });
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await catalogPrisma.$disconnect();
  });

  it("classifies merges, reviews and separations, counts references, and changes nothing", async () => {
    const snapshot = async () => ({
      catalog: await catalogPrisma.catalogBike.findMany({
        where: { brand: { name: BRAND } },
        select: { id: true, yearStart: true, yearEnd: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      parts: await catalogPrisma.catalogComponent.count({ where: { bike: { brand: { name: BRAND } } } }),
      jobBikes: await prisma.jobBike.findMany({ where: { jobId }, select: { id: true, catalogBikeId: true } }),
      bike: await prisma.bike.findMany({ where: { customerId }, select: { catalogBikeId: true, updatedAt: true } }),
    });
    const before = await snapshot();

    const { report, files } = await runConsolidationReport({ outDir, quiet: true });
    const r = report.json;
    assert.equal(r.readOnly, true);
    assert.ok(fs.existsSync(files.markdown) && fs.existsSync(files.json));

    const mine = <T extends { brand: string }>(list: T[]) => list.filter((x) => x.brand === BRAND);

    const merges = mine(r.safeMerges);
    const t9 = merges.find((m) => m.model === "Trail 9")!;
    assert.equal(t9.kind, "safe");
    assert.equal(t9.toYears, "2019–2020");
    assert.equal(t9.survivor.id, ids["t9-2019"]);
    assert.deepEqual(t9.members.map((m) => m.id), [ids["t9-2020"]]);
    assert.equal(t9.affected.activeJobs, 1);
    assert.equal(t9.affected.confirmedBuilds, 1);
    assert.deepEqual(t9.affected.jobIds, [jobId]);

    const t7 = merges.find((m) => m.model === "Trail 7")!;
    assert.equal(t7.kind, "template_copy");
    assert.equal(t7.toYears, "2018–2020");

    const review = mine(r.needsReview).find((p) => p.model === "Trail 5")!;
    assert.match(review.reasons.join(" "), /Fit-critical evidence missing: Bottom bracket/);

    const separate = mine(r.keptSeparate).find((p) => p.model === "Trail 9")!;
    assert.deepEqual(separate.years, ["2020", "2021"]);
    assert.match(separate.reasons.join(" "), /Bottom bracket differs \(fit-critical\)/);

    // The near-identical trim was never compared with anything.
    const proId = ids["t9pro-2019"];
    const touchesPro = [...r.safeMerges, ...r.needsReview, ...r.keptSeparate].some((x) =>
      JSON.stringify(x).includes(proId)
    );
    assert.equal(touchesPro, false);

    const md = fs.readFileSync(files.markdown, "utf8");
    for (const heading of ["## 1. Safe merge candidates", "## 2. Needs review", "## 3. Must stay separate", "## Merge criteria"]) {
      assert.ok(md.includes(heading), heading);
    }

    assert.deepEqual(await snapshot(), before, "the report changed nothing");
  });

  it("relies on Postgres to refuse writes in its read-only transactions", async () => {
    await assert.rejects(
      catalogPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.catalogBrand.create({ data: { name: `${BRAND}-write`, slug: `${BRAND.toLowerCase()}-write` } });
      }),
      /read-only transaction/
    );
    assert.equal(await catalogPrisma.catalogBrand.count({ where: { name: `${BRAND}-write` } }), 0);
  });
});
