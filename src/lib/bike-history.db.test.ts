/**
 * Customer bike history and build confirmation, against a real database.
 *
 *   npm run test:catalog:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 * Everything it makes hangs off one test customer / brand and is deleted after.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS helper shared with the build scripts
const { loadDotEnv } = require("../../scripts/db-url-diagnostics");

const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";

type Prisma = typeof import("@/lib/db")["prisma"];
type CatalogPrisma = typeof import("../../bike-catalog/lib/db")["catalogPrisma"];

let prisma: Prisma;
let catalogPrisma: CatalogPrisma;
let history: typeof import("./bike-installed-components");
let build: typeof import("./customer-bike-build");
let lookup: typeof import("./bike-catalog-lookup");
let upsert: typeof import("../../bike-catalog/lib/upsert");
let verify: typeof import("../../bike-catalog/lib/verify");

const RUN = Date.now().toString(36);
const MAKE = `Zzh${RUN}`;
let shopId: string;
let customerId: string;
let bikeId: string;
const jobIds: string[] = [];

async function newVisit(stage: "BOOKED_IN" | "WORKING_ON" | "PENDING_APPROVAL" = "WORKING_ON", model = "Ridge 8") {
  const job = await prisma.job.create({
    data: { shopId, customerId, bikeMake: MAKE, bikeModel: model, stage },
  });
  jobIds.push(job.id);
  const jobBike = await prisma.jobBike.create({
    data: { shopId, jobId: job.id, make: MAKE, model, year: 2021, bikeId, sortOrder: 0, catalogLookupAt: new Date() },
  });
  return { job, jobBike };
}

async function noteOnJob(
  jobBikeId: string,
  slot: string,
  data: {
    replacementState?: "NONE" | "PLANNED" | "INSTALLED";
    replacementValue?: string;
    confirmation?: "UNREVIEWED" | "MATCHES_CATALOG" | "CUSTOMIZED";
    customValue?: string;
  }
) {
  return prisma.jobBikeComponentOverride.upsert({
    where: { jobBikeId_slot: { jobBikeId, slot } },
    create: {
      shopId,
      jobBikeId,
      slot,
      ...data,
      replacementInstalledAt: data.replacementState === "INSTALLED" ? new Date() : null,
      updatedBy: "Test Mechanic",
    },
    update: {
      ...data,
      replacementInstalledAt: data.replacementState === "INSTALLED" ? new Date() : null,
    },
  });
}

async function bikeRecord() {
  return prisma.bikeInstalledComponent.findMany({ where: { bikeId }, orderBy: { recordedAt: "asc" } });
}

async function markBikeDone(jobBikeId: string, done = true) {
  await prisma.jobBike.update({ where: { id: jobBikeId }, data: { completedAt: done ? new Date() : null } });
}

async function setStage(jobId: string, stage: "CANCELLED" | "COMPLETED" | "BIKE_READY" | "WAITING_ON_PARTS") {
  await prisma.job.update({ where: { id: jobId }, data: { stage } });
}

async function makeBuild(model: string, specStatus: "SOURCED" | "VERIFIED" = "SOURCED") {
  const brand = await catalogPrisma.catalogBrand.upsert({
    where: { slug: MAKE.toLowerCase() },
    create: { name: MAKE, slug: MAKE.toLowerCase() },
    update: {},
  });
  return upsert.createCatalogBikeWithComponents({
    brandId: brand.id,
    model,
    yearStart: 2021,
    yearEnd: 2021,
    externalKey: `${RUN}-${model}`,
    confidence: 0.7,
    specStatus,
    components: [
      { slot: "CASSETTE", value: `${model} cassette`, source: "THIRD_PARTY", sourceUrl: "https://example.com/a" },
      { slot: "BOTTOM_BRACKET", value: "BB92 press-fit", standard: "BB92", source: "THIRD_PARTY", sourceUrl: "https://example.com/a" },
    ],
  });
}

describe("customer bike history and confirmed builds", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadDotEnv();
    process.env.CATALOG_DATABASE_URL ||= process.env.DATABASE_URL;
    const url = process.env.DATABASE_URL ?? "";
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.includes(PRODUCTION_REF) || process.env.VERCEL_ENV === "production") {
      throw new Error("Refusing to run DB tests against production");
    }
    ({ prisma } = await import("@/lib/db"));
    ({ catalogPrisma } = await import("../../bike-catalog/lib/db"));
    history = await import("./bike-installed-components");
    build = await import("./customer-bike-build");
    lookup = await import("./bike-catalog-lookup");
    upsert = await import("../../bike-catalog/lib/upsert");
    verify = await import("../../bike-catalog/lib/verify");

    shopId = (await prisma.shop.findFirstOrThrow({ select: { id: true } })).id;
    customerId = (await prisma.customer.create({ data: { shopId, firstName: `Test ${MAKE}` } })).id;
  });

  beforeEach(async () => {
    // A clean catalog and a fresh customer bike for every test.
    await catalogPrisma.catalogBrand.deleteMany({ where: { name: { startsWith: MAKE } } });
    await catalogPrisma.catalogLookup.deleteMany({ where: { key: { startsWith: MAKE.toLowerCase() } } });
    bikeId = (await prisma.bike.create({ data: { shopId, customerId, make: MAKE, model: "Ridge 8", year: 2021 } })).id;
  });

  after(async () => {
    if (!prisma) return;
    for (const id of jobIds) await prisma.job.delete({ where: { id } }).catch(() => {});
    if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    await prisma.product.deleteMany({ where: { name: { startsWith: MAKE } } });
    await catalogPrisma.catalogBrand.deleteMany({ where: { name: { startsWith: MAKE } } });
    await catalogPrisma.catalogLookup.deleteMany({ where: { key: { startsWith: MAKE.toLowerCase() } } });
    await prisma.$disconnect();
    await catalogPrisma.$disconnect();
  });

  it("records an installed part only once the bike is done, with the job and date", async () => {
    const { job, jobBike } = await newVisit();
    const override = await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });

    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0, "nothing while the work is in progress");

    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    const [record] = await bikeRecord();
    assert.equal(record.value, "SRAM GX 10-52");
    assert.equal(record.kind, "INSTALLED");
    assert.equal(record.jobId, job.id);
    assert.equal(record.jobBikeId, jobBike.id);
    assert.equal(record.overrideId, override.id);
    assert.equal(record.confirmedBy, "Test Mechanic");
    assert.equal(record.recordedAt.toISOString(), override.replacementInstalledAt!.toISOString());

    // Running it again changes nothing.
    assert.deepEqual(await history.reconcileInstalledComponents(job.id), { added: 0, updated: 0, withdrawn: 0 });
  });

  it("never records a part that was only planned or ordered", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "PLANNED", replacementValue: "SRAM GX 10-52" });
    // The part is on order: a product on the job, and the job waiting on parts.
    const product = await prisma.product.create({ data: { shopId, name: `${MAKE} GX cassette`, price: 120 } });
    await prisma.jobProduct.create({ data: { shopId, jobId: job.id, productId: product.id, unitPrice: 120 } });
    await setStage(job.id, "WAITING_ON_PARTS");
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);

    // Even when the job completes, a part never marked installed stays off the record.
    await markBikeDone(jobBike.id);
    await setStage(job.id, "COMPLETED");
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("never records from a cancelled job", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await setStage(job.id, "CANCELLED");
    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("withdraws a record if the job is cancelled after the bike was done", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 1);

    await setStage(job.id, "CANCELLED");
    const counts = await history.reconcileInstalledComponents(job.id);
    assert.equal(counts.withdrawn, 1);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("never records from a job still awaiting approval", async () => {
    const { job, jobBike } = await newVisit("PENDING_APPROVAL");
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("withdraws a record when the bike is un-marked done", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    await markBikeDone(jobBike.id, false);
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("withdraws a record when the mechanic says it wasn't installed after all", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await markBikeDone(jobBike.id);
    await history.reconcileInstalledComponents(job.id);
    await noteOnJob(jobBike.id, "CASSETTE", { replacementState: "PLANNED", replacementValue: "SRAM GX 10-52" });
    await history.reconcileInstalledComponents(job.id);
    assert.equal((await bikeRecord()).length, 0);
  });

  it("records a non-factory part the mechanic saw on the bike, once the visit is done", async () => {
    const { job, jobBike } = await newVisit();
    await noteOnJob(jobBike.id, "BRAKES", { confirmation: "CUSTOMIZED", customValue: "Shimano XT M8120" });
    await setStage(job.id, "BIKE_READY");
    await history.reconcileInstalledComponents(job.id);
    const [record] = await bikeRecord();
    assert.equal(record.kind, "OBSERVED");
    assert.equal(record.value, "Shimano XT M8120");
  });

  it("carries the bike's record to the next visit, newest first, without touching the factory spec", async () => {
    const factory = await makeBuild("Ridge 8 XT");

    const first = await newVisit();
    await noteOnJob(first.jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "SRAM GX 10-52" });
    await markBikeDone(first.jobBike.id);
    await setStage(first.job.id, "COMPLETED");
    await history.reconcileInstalledComponents(first.job.id);

    // Next visit: the bike shows what was fitted last time.
    const second = await newVisit();
    let parts = await history.installedPartsForBike(bikeId);
    assert.equal(parts.current.CASSETTE.value, "SRAM GX 10-52");
    assert.equal(parts.current.CASSETTE.jobId, first.job.id);

    // This visit fits something else; history keeps both.
    await new Promise((r) => setTimeout(r, 20));
    await noteOnJob(second.jobBike.id, "CASSETTE", { replacementState: "INSTALLED", replacementValue: "Shimano XT 10-51" });
    await markBikeDone(second.jobBike.id);
    await history.reconcileInstalledComponents(second.job.id);
    parts = await history.installedPartsForBike(bikeId);
    assert.equal(parts.current.CASSETTE.value, "Shimano XT 10-51");
    assert.deepEqual(parts.history.CASSETTE.map((p) => p.value), ["Shimano XT 10-51", "SRAM GX 10-52"]);

    // The shared factory spec is untouched.
    const cassette = await catalogPrisma.catalogComponent.findUniqueOrThrow({
      where: { bikeId_slot: { bikeId: factory.id, slot: "CASSETTE" } },
    });
    assert.equal(cassette.value, "Ridge 8 XT cassette");
  });

  it("remembers the build a mechanic confirmed and reuses it next visit without searching", async () => {
    const xt = await makeBuild("Ridge 8 XT");
    await makeBuild("Ridge 8 GX");

    const first = await newVisit();
    const searches: string[] = [];
    const searcher = async () => {
      searches.push("search");
      return null;
    };
    assert.equal(await lookup.lookupCatalogForJobBike(first.jobBike.id, { searcher }), "needs_choice");

    await build.confirmBuildForJobBike({ jobBikeId: first.jobBike.id, catalogBikeId: xt.id, confirmedBy: "Test Mechanic" });
    const bike = await prisma.bike.findUniqueOrThrow({ where: { id: bikeId } });
    assert.equal(bike.catalogBikeId, xt.id);
    assert.equal(bike.catalogConfirmedBy, "Test Mechanic");
    assert.equal(bike.catalogConfirmedJobId, first.job.id);
    assert.ok(bike.catalogConfirmedAt);

    const second = await newVisit();
    assert.equal(await lookup.lookupCatalogForJobBike(second.jobBike.id, { searcher }), "linked");
    const linked = await prisma.jobBike.findUniqueOrThrow({ where: { id: second.jobBike.id } });
    assert.equal(linked.catalogBikeId, xt.id);
    assert.equal(searches.length, 0);
  });

  it("doesn't reuse a confirmed build for a bike now described differently", async () => {
    const xt = await makeBuild("Ridge 8 XT");
    const first = await newVisit();
    await build.confirmBuildForJobBike({ jobBikeId: first.jobBike.id, catalogBikeId: xt.id, confirmedBy: null });
    assert.equal(
      await build.confirmedBuildForJobBike({ bikeId, make: MAKE, model: "Ridge 9", year: 2021 }),
      null
    );
    assert.equal(
      await build.confirmedBuildForJobBike({ bikeId, make: MAKE, model: "Ridge 8", year: 2024 }),
      null,
      "years apart: a different bike"
    );
  });

  it("doesn't remember a build that was only matched automatically", async () => {
    await makeBuild("Ridge 8");
    const { jobBike } = await newVisit();
    assert.equal(await lookup.lookupCatalogForJobBike(jobBike.id, { searcher: async () => null }), "linked");
    const bike = await prisma.bike.findUniqueOrThrow({ where: { id: bikeId } });
    assert.equal(bike.catalogConfirmedAt, null);
  });

  it("records who verified which parts, and clears a part's verification when its value changes", async () => {
    const row = await makeBuild("Ridge 8 XT");
    await verify.recordCatalogVerification(row.id, {
      identity: true,
      slots: ["CASSETTE"],
      basis: "https://example.com/trek-2021-spec",
      verifiedBy: "admin@example.com",
    });
    let saved = await catalogPrisma.catalogBike.findUniqueOrThrow({ where: { id: row.id }, include: { components: true } });
    assert.equal(saved.specStatus, "VERIFIED");
    assert.equal(saved.verifiedBy, "admin@example.com");
    const cassette = saved.components.find((c) => c.slot === "CASSETTE")!;
    const bb = saved.components.find((c) => c.slot === "BOTTOM_BRACKET")!;
    assert.equal(cassette.verifiedBy, "admin@example.com");
    assert.equal(cassette.verifiedAgainst, "https://example.com/trek-2021-spec");
    assert.equal(bb.verifiedAt, null, "approving the build didn't verify the other parts");

    // Saving the same cassette keeps its verification; changing the BB doesn't touch it.
    await upsert.replaceCatalogComponents(row.id, [
      { slot: "CASSETTE", value: cassette.value },
      { slot: "BOTTOM_BRACKET", value: "BSA threaded", standard: "BSA 73mm" },
    ]);
    saved = await catalogPrisma.catalogBike.findUniqueOrThrow({ where: { id: row.id }, include: { components: true } });
    assert.ok(saved.components.find((c) => c.slot === "CASSETTE")!.verifiedAt);

    // Changing the cassette clears it.
    await upsert.replaceCatalogComponents(row.id, [
      { slot: "CASSETTE", value: "Something else" },
      { slot: "BOTTOM_BRACKET", value: "BSA threaded", standard: "BSA 73mm" },
    ]);
    saved = await catalogPrisma.catalogBike.findUniqueOrThrow({ where: { id: row.id }, include: { components: true } });
    const changed = saved.components.find((c) => c.slot === "CASSETTE")!;
    assert.equal(changed.verifiedAt, null);
    assert.equal(changed.source, "ADMIN");
  });

  it("un-verifies a build whose identity is edited, and won't verify one through a plain edit", async () => {
    const row = await makeBuild("Ridge 8 XT");
    await assert.rejects(upsert.updateCatalogBikeMeta(row.id, { specStatus: "VERIFIED" }));

    await verify.recordCatalogVerification(row.id, {
      identity: true,
      slots: [],
      basis: "Inspected the bike",
      verifiedBy: "admin@example.com",
    });
    await upsert.updateCatalogBikeMeta(row.id, { yearEnd: 2022 });
    const saved = await catalogPrisma.catalogBike.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(saved.specStatus, "SOURCED");
    assert.equal(saved.verifiedBy, null);
  });
});
