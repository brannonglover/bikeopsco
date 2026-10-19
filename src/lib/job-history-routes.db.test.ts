/**
 * Repair history survives ordinary edits, and can't be destroyed or orphaned
 * by removals or deletes — through the real route handlers, against staging.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let jobRoute: typeof import("@/app/api/jobs/[id]/route");
let customerRoute: typeof import("@/app/api/customers/[id]/route");
let customerBikeRoute: typeof import("@/app/api/customers/[id]/bikes/[bikeId]/route");
let history: typeof import("./bike-installed-components");

let S: TestShop;
let fx: { customerId: string; bikeId: string; jobId: string; jobBikeId: string; recordId: string };

const params = (id: string) => ({ params: { id } });
const patchJob = (jobId: string, body: unknown) =>
  jobRoute.PATCH(request("PATCH", `/api/jobs/${jobId}`, { host: S.host, as: S, body }), params(jobId));

/** A completed visit that fitted a cassette, recorded on the customer's bike. */
async function completedVisit() {
  const customer = await prisma.customer.create({ data: { shopId: S.id, firstName: `History ${RUN}` } });
  const bike = await prisma.bike.create({
    data: { shopId: S.id, customerId: customer.id, make: "Trek", model: "Fuel EX 8", year: 2021 },
  });
  const job = await prisma.job.create({
    data: { shopId: S.id, customerId: customer.id, bikeMake: "Trek", bikeModel: "Fuel EX 8", stage: "WORKING_ON" },
  });
  const jobBike = await prisma.jobBike.create({
    data: {
      shopId: S.id,
      jobId: job.id,
      make: "Trek",
      model: "Fuel EX 8",
      year: 2021,
      bikeId: bike.id,
      sortOrder: 0,
      completedAt: new Date(),
      catalogLookupAt: new Date(),
    },
  });
  await prisma.jobBikeComponentOverride.create({
    data: {
      shopId: S.id,
      jobBikeId: jobBike.id,
      slot: "CASSETTE",
      replacementState: "INSTALLED",
      replacementValue: "SRAM GX 10-52",
      replacementInstalledAt: new Date(),
    },
  });
  await history.reconcileInstalledComponents(job.id);
  const [record] = await prisma.bikeInstalledComponent.findMany({ where: { bikeId: bike.id } });
  assert.ok(record, "fixture recorded the cassette");
  return { customerId: customer.id, bikeId: bike.id, jobId: job.id, jobBikeId: jobBike.id, recordId: record.id };
}

async function recordStillThere() {
  return prisma.bikeInstalledComponent.findUnique({ where: { id: fx.recordId } });
}

describe("repair history through the routes", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    jobRoute = await import("@/app/api/jobs/[id]/route");
    customerRoute = await import("@/app/api/customers/[id]/route");
    customerBikeRoute = await import("@/app/api/customers/[id]/bikes/[bikeId]/route");
    history = await import("./bike-installed-components");
    S = await createTestShop(prisma, `zzsh-${RUN}`);
  });

  beforeEach(async () => {
    fx = await completedVisit();
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await prisma.$disconnect();
  });

  it("changing the bike type keeps the bike's id, done state, year and history", async () => {
    // What the web job screen sends for a type change: the whole list, with ids, no year.
    const res = await patchJob(fx.jobId, {
      bikes: [{ id: fx.jobBikeId, make: "Trek", model: "Fuel EX 8", nickname: null, imageUrl: null, bikeId: fx.bikeId, bikeType: "E_BIKE" }],
    });
    assert.equal(res.status, 200);
    const jobBikes = await prisma.jobBike.findMany({ where: { jobId: fx.jobId } });
    assert.equal(jobBikes.length, 1);
    assert.equal(jobBikes[0].id, fx.jobBikeId, "same job bike");
    assert.equal(jobBikes[0].bikeType, "E_BIKE");
    assert.equal(jobBikes[0].year, 2021, "year kept though the client didn't send it");
    assert.ok(jobBikes[0].completedAt, "still done");
    assert.ok(await recordStillThere(), "history kept");
  });

  it("an older client that sends no ids keeps identity too", async () => {
    const res = await patchJob(fx.jobId, {
      bikes: [{ make: "Trek", model: "Fuel EX 8", nickname: null, imageUrl: null, bikeId: null }],
    });
    assert.equal(res.status, 200);
    const [jobBike] = await prisma.jobBike.findMany({ where: { jobId: fx.jobId } });
    assert.equal(jobBike.id, fx.jobBikeId);
    assert.equal(jobBike.bikeId, fx.bikeId, "customer bike link kept");
    assert.ok(await recordStillThere());
  });

  it("a completed job's bikes can still be edited without losing history", async () => {
    await prisma.job.update({ where: { id: fx.jobId }, data: { stage: "COMPLETED", completedAt: new Date() } });
    const res = await patchJob(fx.jobId, {
      bikes: [{ id: fx.jobBikeId, make: "Trek", model: "Fuel EX 8", nickname: "Blue one", imageUrl: null, bikeId: fx.bikeId }],
    });
    assert.equal(res.status, 200);
    assert.equal((await prisma.jobBike.findUniqueOrThrow({ where: { id: fx.jobBikeId } })).nickname, "Blue one");
    assert.ok(await recordStillThere());
  });

  it("replacing a bike that has history is refused, and nothing changes", async () => {
    const res = await patchJob(fx.jobId, {
      bikes: [{ make: "Giant", model: "Talon", nickname: null, imageUrl: null, bikeId: null }],
    });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /Un-mark that bike as done/);
    const jobBikes = await prisma.jobBike.findMany({ where: { jobId: fx.jobId } });
    assert.deepEqual(jobBikes.map((b) => b.id), [fx.jobBikeId]);
    assert.ok(await recordStillThere());
  });

  it("removing a bike with history is refused until it's un-marked done", async () => {
    const refused = await patchJob(fx.jobId, { removeJobBikeId: fx.jobBikeId });
    assert.equal(refused.status, 409);
    assert.ok(await prisma.jobBike.findUnique({ where: { id: fx.jobBikeId } }));
    assert.ok(await recordStillThere());

    // The deliberate route: un-mark done (withdraws the record), then remove.
    assert.equal((await patchJob(fx.jobId, { uncompleteJobBikeId: fx.jobBikeId })).status, 200);
    assert.equal(await recordStillThere(), null, "withdrawn deliberately");
    assert.equal((await patchJob(fx.jobId, { removeJobBikeId: fx.jobBikeId })).status, 200);
    assert.equal(await prisma.jobBike.findUnique({ where: { id: fx.jobBikeId } }), null);
  });

  it("deleting a job with history is refused until it's cancelled — no orphans", async () => {
    const del = () => jobRoute.DELETE(request("DELETE", `/api/jobs/${fx.jobId}`, { host: S.host, as: S }), params(fx.jobId));
    const refused = await del();
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: string }).error, /Cancel the job first/);
    assert.ok(await prisma.job.findUnique({ where: { id: fx.jobId } }));

    const cancel = await patchJob(fx.jobId, { stage: "CANCELLED", cancellationReason: "Entered in error" });
    assert.equal(cancel.status, 200);
    assert.equal(await recordStillThere(), null, "cancelling withdrew it");

    assert.equal((await del()).status, 200);
    assert.equal(await prisma.bikeInstalledComponent.count({ where: { jobId: null, bikeId: fx.bikeId } }), 0, "no orphans");
  });

  it("deleting a customer bike with history is refused unless deliberately confirmed", async () => {
    const bp = () => ({ params: Promise.resolve({ id: fx.customerId, bikeId: fx.bikeId }) });
    const path = `/api/customers/${fx.customerId}/bikes/${fx.bikeId}`;
    const refused = await customerBikeRoute.DELETE(request("DELETE", path, { host: S.host, as: S }), bp());
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as { recordCount: number }).recordCount, 1);
    assert.ok(await recordStillThere());

    const confirmed = await customerBikeRoute.DELETE(
      request("DELETE", `${path}?confirmRepairHistoryDeletion=true&reason=Customer%20privacy%20request`, { host: S.host, as: S }),
      bp()
    );
    assert.equal(confirmed.status, 200);
    assert.equal(await recordStillThere(), null);
  });

  it("deleting a customer whose bike has history is refused", async () => {
    const res = await customerRoute.DELETE(
      request("DELETE", `/api/customers/${fx.customerId}`, { host: S.host, as: S }),
      { params: Promise.resolve({ id: fx.customerId }) }
    );
    assert.equal(res.status, 409);
    assert.ok(await prisma.customer.findUnique({ where: { id: fx.customerId } }));
    assert.ok(await recordStillThere());
  });

  it("the next visit still shows what was fitted, after the bike was edited", async () => {
    await patchJob(fx.jobId, {
      bikes: [{ id: fx.jobBikeId, make: "Trek", model: "Fuel EX 8", nickname: null, imageUrl: null, bikeId: fx.bikeId, bikeType: "E_BIKE" }],
    });
    const next = await prisma.job.create({
      data: { shopId: S.id, customerId: fx.customerId, bikeMake: "Trek", bikeModel: "Fuel EX 8" },
    });
    await prisma.jobBike.create({
      data: { shopId: S.id, jobId: next.id, make: "Trek", model: "Fuel EX 8", year: 2021, bikeId: fx.bikeId, sortOrder: 0 },
    });
    const parts = await history.installedPartsForBike(fx.bikeId);
    assert.equal(parts.current.CASSETTE?.value, "SRAM GX 10-52");
    assert.equal(parts.current.CASSETTE?.jobId, fx.jobId);
  });

  it("the guard used by the customer app refuses a bike with shop history", async () => {
    await assert.rejects(
      prisma.$transaction((tx) =>
        history.assertNoRepairHistory(tx, { bikeId: fx.bikeId }, "has history")
      ),
      /has history/
    );
  });
});
