/**
 * The Parts tab (POST/GET /api/jobs/[id]/bike-specs) through the real route
 * handler, against staging: matching and linking, remembered and confirmed
 * builds, concurrent loads, and what happens when either database can't be
 * reached — before or in the middle of a request.
 *
 *   npm run test:parts:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 * Paid web lookups are off (budget 0). Everything hangs off one throwaway shop
 * and one test catalog brand, deleted afterwards.
 */
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);
const MAKE = `Zzpt${RUN}`;

type AppClient = typeof import("@/lib/db")["prisma"];
type CatalogClient = typeof import("../../bike-catalog/lib/db")["catalogPrisma"];

/**
 * Fault injection. The app reads through these stand-ins for the two clients;
 * while a fault is set, matching model calls go to a client pointed at a
 * closed port instead, so they fail exactly as an unreachable database does.
 */
type Fault = { client: "app" | "catalog"; models?: string[]; afterCalls?: number };
let fault: Fault | null = null;
let faultCalls = 0;
const UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=2";

function shouldFail(client: Fault["client"], model: string): boolean {
  if (!fault || fault.client !== client) return false;
  if (fault.models && !fault.models.includes(model)) return false;
  return faultCalls++ >= (fault.afterCalls ?? 0);
}

function faulty(client: Fault["client"], real: () => object, broken: () => object): object {
  return new Proxy(
    {},
    {
      get(_, key) {
        const target = real() as Record<string | symbol, unknown>;
        const value = Reflect.get(target, key);
        if (typeof key !== "string" || key.startsWith("$") || typeof value !== "object" || value === null) {
          return typeof value === "function" ? value.bind(target) : value;
        }
        const delegate = value as Record<string, unknown>;
        return new Proxy(delegate, {
          get(d, op) {
            const fn = Reflect.get(d, op);
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              if (shouldFail(client, key)) {
                const b = (broken() as Record<string, Record<string | symbol, (...a: unknown[]) => unknown>>)[key];
                return b[op](...args);
              }
              return fn.apply(d, args);
            };
          },
        });
      },
    }
  );
}

let prisma: AppClient;
let catalogPrisma: CatalogClient;
let brokenApp: AppClient;
let brokenCatalog: CatalogClient;
let route: typeof import("@/app/api/jobs/[id]/bike-specs/route");
let upsert: typeof import("../../bike-catalog/lib/upsert");
let lookupKey: typeof import("./bike-catalog-lookup")["catalogLookupKey"];

let S: TestShop;
let customerId: string;
let ridge: { id: string };

const params = (id: string) => ({ params: { id } });

async function post(jobBike: { id: string; jobId: string }, body: Record<string, unknown> = {}) {
  const res = await route.POST(
    request("POST", `/api/jobs/${jobBike.jobId}/bike-specs`, { host: S.host, as: S, body: { jobBikeId: jobBike.id, ...body } }),
    params(jobBike.jobId)
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { status: string } };
}

async function get(jobBike: { id: string; jobId: string }) {
  const res = await route.GET(
    request("GET", `/api/jobs/${jobBike.jobId}/bike-specs?jobBikeId=${jobBike.id}`, { host: S.host, as: S }),
    params(jobBike.jobId)
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { status: string } };
}

/** A customer bike and a job for it. `catalogLookupAt` is set: the save-time lookup already ran. */
async function visit(model: string, options: { year?: number; linkTo?: string } = {}) {
  const bike = await prisma.bike.create({
    data: { shopId: S.id, customerId, make: MAKE, model, year: options.year ?? 2021 },
  });
  const job = await prisma.job.create({
    data: { shopId: S.id, customerId, bikeMake: MAKE, bikeModel: model, stage: "WORKING_ON" },
  });
  const jobBike = await prisma.jobBike.create({
    data: {
      shopId: S.id,
      jobId: job.id,
      bikeId: bike.id,
      make: MAKE,
      model,
      year: options.year ?? 2021,
      sortOrder: 0,
      catalogLookupAt: new Date("2026-01-01T00:00:00Z"),
      ...(options.linkTo ? { catalogBikeId: options.linkTo, catalogMatchedAt: new Date() } : {}),
    },
  });
  return { id: jobBike.id, jobId: job.id, bikeId: bike.id };
}

async function build(model: string) {
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
    specStatus: "SOURCED",
    components: [
      { slot: "CASSETTE", value: `${model} cassette`, source: "THIRD_PARTY", sourceUrl: "https://example.com/a" },
      { slot: "BOTTOM_BRACKET", value: "BB92 press-fit", standard: "BB92", source: "THIRD_PARTY", sourceUrl: "https://example.com/a" },
    ],
  });
}

async function jobBikeRow(id: string) {
  return prisma.jobBike.findUniqueOrThrow({
    where: { id },
    select: { catalogBikeId: true, catalogMatchedAt: true, catalogLookupAt: true, catalogLookupNextAt: true },
  });
}

async function lookupRowExists(model: string) {
  return Boolean(await catalogPrisma.catalogLookup.findUnique({ where: { key: lookupKey(MAKE, model, 2021) } }));
}

describe("Parts tab route", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaClient: CatalogPrismaClient } = await import("../../bike-catalog/generated/client");
    const { normalizeDatabaseUrlForPrisma } = await import("./db-url");
    const datasource = (url: string | undefined): { datasources?: { db: { url: string } } } =>
      url ? { datasources: { db: { url } } } : {};
    brokenApp = new PrismaClient({ ...datasource(UNREACHABLE), log: [] });
    brokenCatalog = new CatalogPrismaClient({ ...datasource(UNREACHABLE), log: [] });
    // Clients installed before the tests (e.g. by a preload trying another
    // driver) are the real ones; otherwise the app's usual clients.
    const g = globalThis as unknown as { prisma?: unknown; catalogPrisma?: unknown };
    const preinstalledCatalog = g.catalogPrisma as CatalogClient | undefined;
    const realApp =
      (g.prisma as AppClient | undefined) ??
      new PrismaClient({
        ...datasource(normalizeDatabaseUrlForPrisma(process.env.DATABASE_URL)),
      });
    // The catalog client is made by its module, loaded after the stand-ins.
    const real: { catalog?: CatalogClient } = {};
    // Installed before the app modules load, so they read through these.
    g.prisma = faulty("app", () => realApp, () => brokenApp);
    g.catalogPrisma = faulty("catalog", () => real.catalog!, () => brokenCatalog);
    const catalogDb = await import("../../bike-catalog/lib/db");
    real.catalog = preinstalledCatalog ?? catalogDb.createCatalogPrismaClient();
    prisma = realApp;
    catalogPrisma = real.catalog;

    route = await import("@/app/api/jobs/[id]/bike-specs/route");
    upsert = await import("../../bike-catalog/lib/upsert");
    ({ catalogLookupKey: lookupKey } = await import("./bike-catalog-lookup"));

    S = await createTestShop(prisma, `zzpt-${RUN}`);
    customerId = (await prisma.customer.create({ data: { shopId: S.id, firstName: `Parts ${RUN}` } })).id;
    ridge = await build("Ridge 8");
  });

  afterEach(() => {
    fault = null;
    faultCalls = 0;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await catalogPrisma.catalogBrand.deleteMany({ where: { name: { startsWith: MAKE } } });
    await catalogPrisma.catalogLookup.deleteMany({ where: { key: { startsWith: MAKE.toLowerCase() } } });
    await Promise.all([prisma.$disconnect(), catalogPrisma.$disconnect(), brokenApp.$disconnect(), brokenCatalog.$disconnect()]);
  });

  it("links the one build that is unmistakably this bike, then serves it from the link", async () => {
    const jb = await visit("Ridge 8");
    const first = await post(jb);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, "fetched");
    assert.equal(first.body.catalogBikeId, ridge.id);
    const specs = first.body.specs as { groups: Array<{ items: Array<{ slot: string }> }> };
    assert.deepEqual(specs.groups.flatMap((g) => g.items.map((i) => i.slot)).sort(), ["BOTTOM_BRACKET", "CASSETTE"]);
    assert.equal((await jobBikeRow(jb.id)).catalogBikeId, ridge.id);

    const again = await post(jb);
    assert.equal(again.status, 200);
    assert.equal(again.body.status, "cached");
    assert.equal(again.body.catalogBikeId, ridge.id);

    const read = await get(jb);
    assert.equal(read.status, 200);
    assert.equal(read.body.catalogBikeId, ridge.id);
  });

  it("a bike the catalog doesn't have: no match, and no lookup started while the budget is spent", async () => {
    const jb = await visit("Nomad 99");
    const res = await post(jb);
    assert.equal(res.status, 404);
    assert.equal(res.body.status, "no_match");
    assert.equal(res.body.lookup, "budget");
    assert.equal(await lookupRowExists("Nomad 99"), false);
    const row = await jobBikeRow(jb.id);
    assert.equal(row.catalogBikeId, null);
    assert.equal(row.catalogLookupAt?.toISOString(), "2026-01-01T00:00:00.000Z", "lookup not rescheduled");
  });

  it("two builds sold under the typed name: the mechanic picks, nothing is linked or searched", async () => {
    const gx = await build("Twin 8 GX");
    const xt = await build("Twin 8 XT");
    const jb = await visit("Twin 8");
    const res = await post(jb);
    assert.equal(res.status, 404);
    assert.equal(res.body.status, "ambiguous");
    assert.equal(res.body.lookup, "needs_choice");
    const ids = (res.body.candidates as Array<{ id: string }>).map((c) => c.id).sort();
    assert.deepEqual(ids, [gx.id, xt.id].sort());
    assert.equal((await jobBikeRow(jb.id)).catalogBikeId, null);
    assert.equal(await lookupRowExists("Twin 8"), false);
  });

  it("uses the build a mechanic confirmed for this customer's bike on an earlier visit", async () => {
    const jb = await visit("Ridge 8");
    await prisma.bike.update({
      where: { id: jb.bikeId },
      data: { catalogBikeId: ridge.id, catalogConfirmedAt: new Date(), catalogConfirmedBy: "Earlier Mechanic" },
    });
    const res = await post(jb);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "cached");
    assert.equal(res.body.catalogBikeId, ridge.id);
    assert.deepEqual(
      { confirmed: (res.body.build as { confirmed: boolean }).confirmed, by: (res.body.build as { confirmedBy: string }).confirmedBy },
      { confirmed: true, by: "Earlier Mechanic" }
    );
    const row = await jobBikeRow(jb.id);
    assert.equal(row.catalogBikeId, ridge.id);
    assert.notEqual(row.catalogLookupAt?.toISOString(), "2026-01-01T00:00:00.000Z", "marked as looked up");
  });

  it("confirming the matched build remembers it on the customer's bike and says who confirmed it", async () => {
    const jb = await visit("Ridge 8", { linkTo: ridge.id });
    const res = await post(jb, { confirm: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "fetched");
    const buildStatus = res.body.build as { confirmed: boolean; confirmedBy: string | null; confirmedAt: string | null };
    assert.equal(buildStatus.confirmed, true);
    assert.equal(buildStatus.confirmedBy, `Staff zzpt-${RUN}`);
    assert.ok(buildStatus.confirmedAt);
    const bike = await prisma.bike.findUniqueOrThrow({ where: { id: jb.bikeId } });
    assert.equal(bike.catalogBikeId, ridge.id);
    assert.equal(bike.catalogConfirmedJobId, jb.jobId);
  });

  describe("concurrent loads", () => {
    it("of one bike that matches all agree, and link it once", async () => {
      const jb = await visit("Ridge 8");
      const results = await Promise.all(Array.from({ length: 6 }, () => post(jb)));
      for (const r of results) {
        assert.equal(r.status, 200);
        assert.equal(r.body.catalogBikeId, ridge.id);
        assert.ok(["fetched", "cached"].includes(r.body.status));
      }
      assert.equal((await jobBikeRow(jb.id)).catalogBikeId, ridge.id);
    });

    it("of one bike the catalog doesn't have all say so, and none starts a lookup", async () => {
      const jb = await visit("Nomad 98");
      const results = await Promise.all(Array.from({ length: 6 }, () => post(jb)));
      for (const r of results) {
        assert.equal(r.status, 404);
        assert.equal(r.body.status, "no_match");
        assert.equal(r.body.lookup, "budget");
      }
      assert.equal(await lookupRowExists("Nomad 98"), false);
    });

    it("of different bikes don't mix up their answers", async () => {
      const bikes = await Promise.all([visit("Ridge 8"), visit("Nomad 97"), visit("Ridge 8"), visit("Nomad 96")]);
      const results = await Promise.all(bikes.map((b) => post(b)));
      assert.deepEqual(
        results.map((r) => [r.status, r.body.jobBikeId]),
        bikes.map((b, i) => [i % 2 === 0 ? 200 : 404, b.id])
      );
    });
  });

  describe("when a database can't be reached", () => {
    it("catalog down: an explicit error, the link is kept, and no lookup is started", async () => {
      const linked = await visit("Ridge 8", { linkTo: ridge.id });
      const unlinked = await visit("Nomad 95");
      fault = { client: "catalog" };

      const a = await post(linked);
      assert.equal(a.status, 503);
      assert.equal(a.body.status, "catalog_unavailable");
      assert.match(String(a.body.error), /couldn.t be reached/);
      assert.ok("installed" in a.body && "jobNotes" in a.body, "the bike's own record still shows");
      assert.equal((await jobBikeRow(linked.id)).catalogBikeId, ridge.id, "link kept");

      const b = await post(unlinked);
      assert.equal(b.status, 503);
      assert.equal(b.body.status, "catalog_unavailable");
      assert.equal(b.body.lookup, null);
      fault = null;
      const row = await jobBikeRow(unlinked.id);
      assert.equal(row.catalogLookupAt?.toISOString(), "2026-01-01T00:00:00.000Z", "lookup not rescheduled");
      assert.equal(row.catalogLookupNextAt, null);
      assert.equal(await lookupRowExists("Nomad 95"), false);
    });

    it("catalog down: GET and confirming a build also say so instead of 'no match' / 'doesn't fit'", async () => {
      const jb = await visit("Ridge 8", { linkTo: ridge.id });
      fault = { client: "catalog" };
      const read = await get(jb);
      assert.equal(read.status, 503);
      assert.equal(read.body.status, "catalog_unavailable");
      const confirm = await post(jb, { confirm: true });
      assert.equal(confirm.status, 503);
      assert.equal(confirm.body.status, "catalog_unavailable");
      fault = null;
      const bike = await prisma.bike.findUniqueOrThrow({ where: { id: jb.bikeId } });
      assert.equal(bike.catalogConfirmedAt, null, "nothing confirmed");
    });

    it("catalog drops in the middle of matching: an explicit error and nothing written", async () => {
      const jb = await visit("Nomad 94");
      // The first catalog read (the lookup row) works; the match pool read fails.
      fault = { client: "catalog", afterCalls: 1 };
      const res = await post(jb);
      assert.equal(res.status, 503);
      assert.equal(res.body.status, "catalog_unavailable");
      fault = null;
      const row = await jobBikeRow(jb.id);
      assert.equal(row.catalogBikeId, null);
      assert.equal(row.catalogLookupAt?.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(await lookupRowExists("Nomad 94"), false);
    });

    it("app database drops mid-request: an explicit error, never a match result", async () => {
      const jb = await visit("Ridge 8", { linkTo: ridge.id });
      fault = { client: "app", models: ["jobBikeComponentOverride"] };
      const res = await post(jb);
      assert.equal(res.status, 503);
      assert.equal(res.body.status, "unavailable");
      assert.equal(res.body.specs, null);
      fault = null;
      assert.equal((await jobBikeRow(jb.id)).catalogBikeId, ridge.id);
    });

    it("recovers on the next load once the database is back", async () => {
      const jb = await visit("Ridge 8");
      fault = { client: "catalog" };
      assert.equal((await post(jb)).status, 503);
      fault = null;
      const res = await post(jb);
      assert.equal(res.status, 200);
      assert.equal(res.body.catalogBikeId, ridge.id);
    });
  });
});
