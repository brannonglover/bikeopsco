/**
 * Failure-path tests for the background catalog lookup, against a real
 * database (both the app schema and bike_catalog), with Claude replaced by a
 * fake searcher or a fake API client.
 *
 *   npm run test:catalog:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 * Every row it makes is under a unique test brand / job and deleted after.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import type { LookupResult, LookupClient } from "./catalog-lookup/web-search";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS helper shared with the build scripts
const { loadDotEnv } = require("../../scripts/db-url-diagnostics");

/** Documented in .env.example; the env var wins when set. */
const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";

type Lookup = typeof import("./bike-catalog-lookup");
type Prisma = typeof import("@/lib/db")["prisma"];
type CatalogPrisma = typeof import("../../bike-catalog/lib/db")["catalogPrisma"];

let lookup: Lookup;
let prisma: Prisma;
let catalogPrisma: CatalogPrisma;
let createCatalogBikeWithComponents: typeof import("../../bike-catalog/lib/upsert")["createCatalogBikeWithComponents"];
let createWebSearcher: typeof import("./catalog-lookup/web-search")["createWebSearcher"];

const RUN = Date.now().toString(36);
/** Unique per run so nothing collides with real catalog rows or earlier runs. */
const MAKE = `Zzt${RUN}`;
let shopId: string;
let jobId: string;
let bikeSeq = 0;

function threeParts(prefix: string) {
  const url = `https://www.${MAKE.toLowerCase()}.com/spec`;
  return (["REAR_DERAILLEUR", "CASSETTE", "BOTTOM_BRACKET"] as const).map((slot) => ({
    slot,
    value: `${prefix} ${slot.toLowerCase()}`,
    standard: slot === "BOTTOM_BRACKET" ? "BSA 73mm" : null,
    source: "MANUFACTURER" as const,
    sourceUrl: url,
  }));
}

function found(models: string[], complete = true): LookupResult {
  return {
    brandName: MAKE,
    configurationsComplete: complete,
    lineupSourceUrl: complete ? `https://www.${MAKE.toLowerCase()}.com/lineup` : null,
    variants: models.map((model) => ({
      model,
      family: null,
      category: "Mountain",
      subcategory: null,
      sourceUrl: `https://www.${MAKE.toLowerCase()}.com/spec`,
      components: threeParts(model),
    })),
  };
}

/** A fake web search: counts calls, optionally waits, then returns or throws. */
function fakeSearcher(respond: () => LookupResult | null | Promise<never>, delayMs = 0) {
  const calls: string[] = [];
  const searcher = async (input: { make: string; model: string; year: number }) => {
    calls.push(`${input.model}|${input.year}`);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return respond();
  };
  return { searcher, calls };
}

async function newJobBike(model: string, year: number | null = 2021) {
  bikeSeq += 1;
  return prisma.jobBike.create({
    data: { shopId, jobId, make: MAKE, model, year, sortOrder: bikeSeq },
  });
}

async function lookupRow(model: string, year = 2021) {
  return catalogPrisma.catalogLookup.findUnique({ where: { key: lookup.catalogLookupKey(MAKE, model, year) } });
}

async function jobBikeState(id: string) {
  return prisma.jobBike.findUniqueOrThrow({
    where: { id },
    select: { catalogBikeId: true, catalogLookupAt: true, catalogLookupNextAt: true, catalogLookupAttempts: true },
  });
}

async function clearLookupState() {
  const prefix = MAKE.toLowerCase();
  await catalogPrisma.catalogLookup.deleteMany({ where: { key: { startsWith: prefix } } });
  await catalogPrisma.catalogLookupSpend.deleteMany({ where: { lookupKey: { startsWith: prefix } } });
  await catalogPrisma.catalogBrand.deleteMany({ where: { name: { startsWith: MAKE } } });
}

const budgetEnv = process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD;

describe("catalog lookup against a database", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadDotEnv();
    process.env.CATALOG_DATABASE_URL ||= process.env.DATABASE_URL;
    const url = process.env.DATABASE_URL ?? "";
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.includes(PRODUCTION_REF) || process.env.VERCEL_ENV === "production") {
      throw new Error("Refusing to run catalog DB tests against production");
    }

    lookup = await import("./bike-catalog-lookup");
    ({ prisma } = await import("@/lib/db"));
    ({ catalogPrisma } = await import("../../bike-catalog/lib/db"));
    ({ createCatalogBikeWithComponents } = await import("../../bike-catalog/lib/upsert"));
    ({ createWebSearcher } = await import("./catalog-lookup/web-search"));

    const shop = await prisma.shop.findFirstOrThrow({ select: { id: true } });
    shopId = shop.id;
    const job = await prisma.job.create({
      data: { shopId, bikeMake: MAKE, bikeModel: "test", stage: "BOOKED_IN" },
    });
    jobId = job.id;
  });

  beforeEach(async () => {
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "1000";
    await clearLookupState();
  });

  after(async () => {
    if (budgetEnv === undefined) delete process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD;
    else process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = budgetEnv;
    if (!prisma) return;
    await clearLookupState();
    if (jobId) await prisma.job.delete({ where: { id: jobId } }).catch(() => {});
    await prisma.$disconnect();
    await catalogPrisma.$disconnect();
  });

  it("saves every build of an ambiguous model and links none of them", async () => {
    const fake = fakeSearcher(() => found(["Ridge 8 XT", "Ridge 8 GX"]));
    const bike = await newJobBike("Ridge 8");

    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "needs_choice");
    const state = await jobBikeState(bike.id);
    assert.equal(state.catalogBikeId, null);
    assert.ok(state.catalogLookupAt, "an outcome was reached");

    const rows = await catalogPrisma.catalogBike.findMany({
      where: { brand: { name: MAKE } },
      include: { components: true },
    });
    assert.deepEqual(rows.map((r) => r.model).sort(), ["Ridge 8 GX", "Ridge 8 XT"]);
    assert.ok(rows.every((r) => r.specStatus === "SOURCED" && r.yearStart === 2021 && r.yearEnd === 2021));
    assert.ok(rows.every((r) => r.components.length === 3 && r.components.every((c) => c.sourceUrl)));

    // The next customer with this bike gets the same choice, without another search.
    const second = await newJobBike("Ridge 8");
    assert.equal(await lookup.lookupCatalogForJobBike(second.id, { searcher: fake.searcher }), "needs_choice");
    assert.equal(fake.calls.length, 1);
  });

  it("links a single build only when the search says it found them all", async () => {
    const incomplete = fakeSearcher(() => found(["Ridge 9 XT"], false));
    const bike = await newJobBike("Ridge 9");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: incomplete.searcher }), "needs_choice");
    assert.equal((await jobBikeState(bike.id)).catalogBikeId, null);

    await clearLookupState();
    const complete = fakeSearcher(() => found(["Ridge 9 XT"], true));
    const linked = await newJobBike("Ridge 9");
    assert.equal(await lookup.lookupCatalogForJobBike(linked.id, { searcher: complete.searcher }), "linked");
    assert.ok((await jobBikeState(linked.id)).catalogBikeId);

    // A repeat bike is linked from what's known — no second paid search.
    const repeat = await newJobBike("Ridge 9");
    assert.equal(await lookup.lookupCatalogForJobBike(repeat.id, { searcher: complete.searcher }), "linked");
    assert.equal(complete.calls.length, 1);
  });

  it("runs one search when two jobs bring the same bike in at once", async () => {
    const fake = fakeSearcher(() => found(["Ridge 7 XT"]), 400);
    const [a, b] = [await newJobBike("Ridge 7"), await newJobBike("Ridge 7")];

    const outcomes = await Promise.all([
      lookup.lookupCatalogForJobBike(a.id, { searcher: fake.searcher }),
      lookup.lookupCatalogForJobBike(b.id, { searcher: fake.searcher }),
    ]);
    assert.equal(fake.calls.length, 1);
    assert.deepEqual([...outcomes].sort(), ["linked", "waiting"]);

    // The one that waited is still owed, and the sweep finishes it for free.
    const waiter = outcomes[0] === "waiting" ? a : b;
    const owed = await jobBikeState(waiter.id);
    assert.equal(owed.catalogLookupAt, null);
    assert.ok(owed.catalogLookupNextAt && owed.catalogLookupNextAt > new Date());
    await prisma.jobBike.update({ where: { id: waiter.id }, data: { catalogLookupNextAt: new Date(0) } });
    const sweep = await lookup.sweepCatalogLookups({ jobBikeIds: [waiter.id], searcher: fake.searcher });
    assert.deepEqual(sweep.outcomes, { linked: 1 });
    assert.equal(fake.calls.length, 1);
  });

  it("keeps a rate-limited lookup owed, honours Retry-After, and the sweep retries it", async () => {
    const limited = fakeSearcher(() =>
      Promise.reject(new Anthropic.RateLimitError(429, {}, "slow down", new Headers({ "retry-after": "7200" })))
    );
    const bike = await newJobBike("Ridge 6");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: limited.searcher }), "retry");

    const state = await jobBikeState(bike.id);
    assert.equal(state.catalogLookupAt, null, "still owed — not marked done");
    assert.ok(state.catalogLookupNextAt!.getTime() >= Date.now() + 7_100_000, "waits at least Retry-After");
    const row = await lookupRow("Ridge 6");
    assert.equal(row?.status, "FAILED");
    assert.equal(row?.attempts, 1);

    // Not picked up before its time.
    assert.equal((await lookup.sweepCatalogLookups({ jobBikeIds: [bike.id], searcher: limited.searcher })).attempted, 0);

    // Once the wait is over, the sweep retries — and this time it works.
    await prisma.jobBike.update({ where: { id: bike.id }, data: { catalogLookupNextAt: new Date(0) } });
    await catalogPrisma.catalogLookup.update({ where: { id: row!.id }, data: { nextAttemptAt: new Date(0) } });
    const ok = fakeSearcher(() => found(["Ridge 6"]));
    const sweep = await lookup.sweepCatalogLookups({ jobBikeIds: [bike.id], searcher: ok.searcher });
    assert.deepEqual(sweep.outcomes, { linked: 1 });
    assert.equal((await lookupRow("Ridge 6"))?.attempts, 2);
  });

  it("gives up for good on an error that can't succeed, without paying again", async () => {
    const bad = fakeSearcher(() => Promise.reject(new Anthropic.BadRequestError(400, {}, "bad", new Headers())));
    const bike = await newJobBike("Ridge 5");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: bad.searcher }), "failed");
    assert.ok((await jobBikeState(bike.id)).catalogLookupAt);

    const again = await newJobBike("Ridge 5");
    assert.equal(await lookup.lookupCatalogForJobBike(again.id, { searcher: bad.searcher }), "failed");
    assert.equal(bad.calls.length, 1);
  });

  it("recovers a search interrupted mid-way, counting it as an attempt", async () => {
    const key = lookup.catalogLookupKey(MAKE, "Ridge 4", 2021);
    const stuck = await catalogPrisma.catalogLookup.create({
      data: { key, make: MAKE, model: "Ridge 4", year: 2021, status: "SEARCHING", attempts: 1 },
    });
    await catalogPrisma.$executeRawUnsafe(
      `UPDATE bike_catalog."CatalogLookup" SET "updatedAt" = now() - interval '20 minutes' WHERE id = $1`,
      stuck.id
    );
    // The job bike that was running it never recorded an outcome.
    const bike = await newJobBike("Ridge 4");
    const ok = fakeSearcher(() => found(["Ridge 4"]));
    const sweep = await lookup.sweepCatalogLookups({ jobBikeIds: [bike.id], searcher: ok.searcher });
    assert.deepEqual(sweep.outcomes, { linked: 1 });
    assert.equal((await lookupRow("Ridge 4"))?.attempts, 2);
  });

  it("stops retrying a search that keeps getting interrupted", async () => {
    const key = lookup.catalogLookupKey(MAKE, "Ridge 3", 2021);
    const stuck = await catalogPrisma.catalogLookup.create({
      data: { key, make: MAKE, model: "Ridge 3", year: 2021, status: "SEARCHING", attempts: lookup.MAX_SEARCH_ATTEMPTS },
    });
    await catalogPrisma.$executeRawUnsafe(
      `UPDATE bike_catalog."CatalogLookup" SET "updatedAt" = now() - interval '20 minutes' WHERE id = $1`,
      stuck.id
    );
    const bike = await newJobBike("Ridge 3");
    const fake = fakeSearcher(() => found(["Ridge 3"]));
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "failed");
    assert.equal(fake.calls.length, 0);
    assert.equal((await lookupRow("Ridge 3"))?.status, "FAILED");
  });

  it("doesn't start a paid search once the daily budget is spent", async () => {
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "0";
    const fake = fakeSearcher(() => found(["Ridge 2"]));
    const bike = await newJobBike("Ridge 2");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "budget");
    assert.equal(fake.calls.length, 0);
    assert.equal(await lookupRow("Ridge 2"), null, "no search was claimed");

    const state = await jobBikeState(bike.id);
    assert.equal(state.catalogLookupAt, null);
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    assert.equal(state.catalogLookupNextAt?.toISOString(), midnight.toISOString(), "resumes at UTC midnight");
  });

  it("records each call's usage and stops mid-search when the budget runs out", async () => {
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "1";
    let calls = 0;
    const client = {
      beta: {
        messages: {
          parse: async (_params: unknown, opts: { timeout?: number; maxRetries?: number }) => {
            calls += 1;
            assert.equal(opts.maxRetries, 0, "the SDK must not retry on its own");
            assert.ok(opts.timeout! <= 230_000);
            // One expensive pass ($20 of output) that the server paused.
            return {
              model: "claude-opus-5-5",
              stop_reason: "pause_turn",
              stop_details: null,
              content: [],
              parsed_output: null,
              usage: {
                input_tokens: 1000,
                output_tokens: 1_000_000,
                server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 },
              },
            };
          },
        },
      },
    } as unknown as LookupClient;

    const bike = await newJobBike("Ridge 1");
    const outcome = await lookup.lookupCatalogForJobBike(bike.id, { searcher: createWebSearcher(client) });
    assert.equal(outcome, "budget");
    assert.equal(calls, 1, "no follow-up call after the budget ran out");

    const spend = await catalogPrisma.catalogLookupSpend.findMany({ where: { lookupKey: { startsWith: MAKE.toLowerCase() } } });
    assert.equal(spend.length, 1);
    assert.equal(spend[0].outputTokens, 1_000_000);
    assert.equal(spend[0].webSearches, 3);
    assert.ok(Math.abs(spend[0].costUsd - (1000 * 4 + 1_000_000 * 20) / 1_000_000 - 0.03) < 1e-9);

    // The budget isn't the bike's fault: the attempt is handed back.
    const row = await lookupRow("Ridge 1");
    assert.equal(row?.status, "FAILED");
    assert.equal(row?.attempts, 0);
  });

  it("charges a conservative estimate for a call that timed out", async () => {
    const client = {
      beta: { messages: { parse: async () => Promise.reject(new Anthropic.APIConnectionTimeoutError()) } },
    } as unknown as LookupClient;
    const bike = await newJobBike("Ridge 0");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: createWebSearcher(client) }), "retry");
    const spend = await catalogPrisma.catalogLookupSpend.findMany({ where: { lookupKey: { startsWith: MAKE.toLowerCase() } } });
    assert.equal(spend.length, 1);
    assert.equal(spend[0].estimated, true);
    assert.ok(spend[0].costUsd > 0);
  });

  it("doesn't start a call it can't finish before the deadline", async () => {
    let calls = 0;
    const client = { beta: { messages: { parse: async () => (calls += 1) } } } as unknown as LookupClient;
    const bike = await newJobBike("Ridge 10");
    const outcome = await lookup.lookupCatalogForJobBike(bike.id, {
      searcher: createWebSearcher(client),
      deadline: Date.now() + 5_000,
    });
    assert.equal(outcome, "retry");
    assert.equal(calls, 0);
  });

  it("never overwrites a build sheet that's already in the catalog", async () => {
    const brand = await catalogPrisma.catalogBrand.create({ data: { name: MAKE, slug: MAKE.toLowerCase() } });
    const verified = await createCatalogBikeWithComponents({
      brandId: brand.id,
      model: "Ridge 11 Pro",
      yearStart: 2021,
      yearEnd: 2021,
      externalKey: `${RUN}-verified`,
      confidence: 1,
      specStatus: "VERIFIED",
      components: [{ slot: "CASSETTE", value: "Checked by hand", source: "ADMIN" }],
    });

    // Typed without trim, so the verified row is only a possible match and a search runs.
    const fake = fakeSearcher(() => found(["Ridge 11 Pro", "Ridge 11 Base"]));
    const bike = await newJobBike("Ridge 11");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "needs_choice");

    const row = await lookupRow("Ridge 11");
    assert.ok(row?.catalogBikeIds.includes(verified.id), "reused the existing row");
    const parts = await catalogPrisma.catalogComponent.findMany({ where: { bikeId: verified.id } });
    assert.deepEqual(parts.map((p) => p.value), ["Checked by hand"]);
    const stillVerified = await catalogPrisma.catalogBike.findUniqueOrThrow({ where: { id: verified.id } });
    assert.equal(stillVerified.specStatus, "VERIFIED");
  });

  it("saves a build and its parts together or not at all", async () => {
    const brand = await catalogPrisma.catalogBrand.create({ data: { name: MAKE, slug: MAKE.toLowerCase() } });
    await assert.rejects(
      createCatalogBikeWithComponents({
        brandId: brand.id,
        model: "Half Saved",
        yearStart: 2021,
        yearEnd: 2021,
        externalKey: `${RUN}-half`,
        confidence: 0.5,
        specStatus: "SOURCED",
        components: [
          { slot: "CASSETTE", value: "fine" },
          { slot: "NOT_A_SLOT" as never, value: "breaks the write" },
        ],
      })
    );
    assert.equal(await catalogPrisma.catalogBike.count({ where: { externalKey: `${RUN}-half` } }), 0);
  });

  it("doesn't let an approximate row stop a lookup", async () => {
    const brand = await catalogPrisma.catalogBrand.create({ data: { name: MAKE, slug: MAKE.toLowerCase() } });
    await createCatalogBikeWithComponents({
      brandId: brand.id,
      model: "Ridge 12",
      yearStart: 2019,
      yearEnd: 2023,
      externalKey: `${RUN}-approx`,
      confidence: 0.55,
      specStatus: "APPROXIMATE",
      components: [{ slot: "CASSETTE", value: "varies by trim" }],
    });
    const fake = fakeSearcher(() => found(["Ridge 12"]));
    const bike = await newJobBike("Ridge 12");
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "linked");
    assert.equal(fake.calls.length, 1);
    const linked = await catalogPrisma.catalogBike.findUniqueOrThrow({
      where: { id: (await jobBikeState(bike.id)).catalogBikeId! },
    });
    assert.equal(linked.specStatus, "SOURCED");
  });

  it("never replaces a link a mechanic already made", async () => {
    const fake = fakeSearcher(() => found(["Ridge 13"]));
    const bike = await newJobBike("Ridge 13");
    await prisma.jobBike.update({ where: { id: bike.id }, data: { catalogBikeId: "mechanic-choice" } });
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "already_linked");
    assert.equal((await jobBikeState(bike.id)).catalogBikeId, "mechanic-choice");
    assert.equal(fake.calls.length, 0);
  });

  it("doesn't search without a model year", async () => {
    const fake = fakeSearcher(() => found(["Ridge 14"]));
    const bike = await newJobBike("Ridge 14", null);
    assert.equal(await lookup.lookupCatalogForJobBike(bike.id, { searcher: fake.searcher }), "needs_details");
    assert.equal(fake.calls.length, 0);
  });
});
