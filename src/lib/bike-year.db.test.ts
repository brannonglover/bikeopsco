/**
 * Model year on customer bikes and new jobs, through the real routes against
 * staging: the year is saved, reaches open jobs (so the bike gets looked up),
 * leaves finished visits alone, and flows between a job and the saved bike.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let R: {
  bikes: typeof import("@/app/api/customers/[id]/bikes/route");
  bike: typeof import("@/app/api/customers/[id]/bikes/[bikeId]/route");
  jobs: typeof import("@/app/api/jobs/route");
};
let A: TestShop;
let B: TestShop;
let customerId: string;

const bp = (bikeId: string) => ({ params: Promise.resolve({ id: customerId, bikeId }) });
const patchBike = (bikeId: string, body: unknown, as: TestShop = A) =>
  R.bike.PATCH(request("PATCH", `/api/customers/${customerId}/bikes/${bikeId}`, { host: as.host, as, body }), bp(bikeId));

describe("bike model year", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    R = {
      bikes: await import("@/app/api/customers/[id]/bikes/route"),
      bike: await import("@/app/api/customers/[id]/bikes/[bikeId]/route"),
      jobs: await import("@/app/api/jobs/route"),
    };
    A = await createTestShop(prisma, `zzyr-${RUN}`);
    B = await createTestShop(prisma, `zzyrb-${RUN}`);
    customerId = (await prisma.customer.create({ data: { shopId: A.id, firstName: `Year ${RUN}` } })).id;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("a customer bike can be added with a year, and a bad year is refused", async () => {
    const add = (body: unknown) =>
      R.bikes.POST(request("POST", `/api/customers/${customerId}/bikes`, { host: A.host, as: A, body }), {
        params: Promise.resolve({ id: customerId }),
      });
    const ok = await add({ make: "GT", model: "Outback", year: 1994 });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { year: number }).year, 1994);
    assert.equal((await add({ make: "GT", model: "Outback", year: 1970 })).status, 400);
  });

  it("setting the year reaches the bike on open jobs, not on finished ones", async () => {
    const bike = await prisma.bike.create({ data: { shopId: A.id, customerId, make: "GT", model: "Outback" } });
    const open = await prisma.job.create({ data: { shopId: A.id, customerId, bikeMake: "GT", bikeModel: "Outback", stage: "RECEIVED" } });
    const done = await prisma.job.create({ data: { shopId: A.id, customerId, bikeMake: "GT", bikeModel: "Outback", stage: "COMPLETED", completedAt: new Date() } });
    const openBike = await prisma.jobBike.create({
      data: { shopId: A.id, jobId: open.id, make: "GT", model: "Outback", bikeId: bike.id, sortOrder: 0, catalogLookupAt: new Date() },
    });
    const doneBike = await prisma.jobBike.create({
      data: { shopId: A.id, jobId: done.id, make: "GT", model: "Outback", bikeId: bike.id, sortOrder: 0, catalogLookupAt: new Date() },
    });

    const res = await patchBike(bike.id, { year: 1995 });
    assert.equal(res.status, 200);
    assert.equal((await prisma.bike.findUniqueOrThrow({ where: { id: bike.id } })).year, 1995);
    const o = await prisma.jobBike.findUniqueOrThrow({ where: { id: openBike.id } });
    assert.equal(o.year, 1995, "open job gets the year");
    const d = await prisma.jobBike.findUniqueOrThrow({ where: { id: doneBike.id } });
    assert.equal(d.year, null, "a finished visit keeps what it recorded");
    assert.ok(d.catalogLookupAt, "and isn't queued for a lookup");
  });

  it("another shop can't change the year", async () => {
    const bike = await prisma.bike.create({ data: { shopId: A.id, customerId, make: "GT", model: "Karakoram", year: 1993 } });
    const res = await patchBike(bike.id, { year: 2000 }, B);
    assert.notEqual(res.status, 200);
    assert.equal((await prisma.bike.findUniqueOrThrow({ where: { id: bike.id } })).year, 1993);
  });

  it("a new job takes the saved bike's year, and fills in a saved bike that has none", async () => {
    const withYear = await prisma.bike.create({ data: { shopId: A.id, customerId, make: "GT", model: "Avalanche", year: 1996 } });
    const noYear = await prisma.bike.create({ data: { shopId: A.id, customerId, make: "GT", model: "Timberline" } });
    const create = (bikes: unknown[]) =>
      R.jobs.POST(request("POST", "/api/jobs", { host: A.host, as: A, body: { bikeMake: "GT", customerId, bikes } }));

    const res = await create([
      { make: "GT", model: "Avalanche", bikeId: withYear.id }, // like the phone app: no year sent
      { make: "GT", model: "Timberline", bikeId: noYear.id, year: 1997 },
    ]);
    assert.ok(res.status === 200 || res.status === 201, `status ${res.status}`);
    const jobId = ((await res.json()) as { id: string }).id;
    const jbs = await prisma.jobBike.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(jbs.map((b) => b.year), [1996, 1997]);
    assert.equal((await prisma.bike.findUniqueOrThrow({ where: { id: noYear.id } })).year, 1997, "saved bike filled in");

    // A different year on the job never overwrites the saved bike's.
    await create([{ make: "GT", model: "Avalanche", bikeId: withYear.id, year: 2001 }]);
    assert.equal((await prisma.bike.findUniqueOrThrow({ where: { id: withYear.id } })).year, 1996);
  });
});
