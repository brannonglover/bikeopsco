/**
 * Cross-shop authorization: staff of Shop A must not read, change, delete,
 * archive or reorder Shop B's jobs, customers or bikes through the API. Calls
 * the real route handlers with a real signed session against staging.
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
let jobRoute: typeof import("@/app/api/jobs/[id]/route");
let archiveRoute: typeof import("@/app/api/jobs/archive-completed/route");
let reorderRoute: typeof import("@/app/api/jobs/reorder/route");
let productsRoute: typeof import("@/app/api/jobs/[id]/products/route");
let prefsRoute: typeof import("@/app/api/jobs/[id]/preferences/route");
let smsRoute: typeof import("@/app/api/jobs/[id]/sms-consent/route");
let customerRoute: typeof import("@/app/api/customers/[id]/route");
let customerBikeRoute: typeof import("@/app/api/customers/[id]/bikes/[bikeId]/route");

let A: TestShop;
let B: TestShop;
/** Shop B's records — the target of every attack. */
const b = { customerId: "", bikeId: "", jobId: "", jobBikeId: "", completedJobId: "" };
const a = { productId: "", jobId: "", completedJobId: "" };

const params = (id: string) => ({ params: { id } });

async function snapshotB() {
  const [job, completed, customer, bike, products] = await Promise.all([
    prisma.job.findUnique({ where: { id: b.jobId }, select: { notes: true, columnSortOrder: true, stage: true } }),
    prisma.job.findUnique({ where: { id: b.completedJobId }, select: { archivedAt: true } }),
    prisma.customer.findUnique({
      where: { id: b.customerId },
      select: { firstName: true, smsConsent: true, emailUpdatesConsent: true },
    }),
    prisma.bike.findUnique({ where: { id: b.bikeId }, select: { model: true } }),
    prisma.jobProduct.count({ where: { jobId: b.jobId } }),
  ]);
  const jobBikes = await prisma.jobBike.count({ where: { jobId: b.jobId } });
  return { job, completed, customer, bike, products, jobBikes };
}

describe("cross-shop authorization", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    jobRoute = await import("@/app/api/jobs/[id]/route");
    archiveRoute = await import("@/app/api/jobs/archive-completed/route");
    reorderRoute = await import("@/app/api/jobs/reorder/route");
    productsRoute = await import("@/app/api/jobs/[id]/products/route");
    prefsRoute = await import("@/app/api/jobs/[id]/preferences/route");
    smsRoute = await import("@/app/api/jobs/[id]/sms-consent/route");
    customerRoute = await import("@/app/api/customers/[id]/route");
    customerBikeRoute = await import("@/app/api/customers/[id]/bikes/[bikeId]/route");

    A = await createTestShop(prisma, `zzsa-${RUN}`);
    B = await createTestShop(prisma, `zzsb-${RUN}`);

    const customer = await prisma.customer.create({
      data: { shopId: B.id, firstName: "Victim", email: "victim@example.test", phone: "+15555550100", smsConsent: true, emailUpdatesConsent: true },
    });
    b.customerId = customer.id;
    b.bikeId = (await prisma.bike.create({ data: { shopId: B.id, customerId: customer.id, make: "Trek", model: "Marlin 7" } })).id;
    const job = await prisma.job.create({
      data: { shopId: B.id, customerId: customer.id, bikeMake: "Trek", bikeModel: "Marlin 7", stage: "WORKING_ON", notes: "B's notes", columnSortOrder: 5 },
    });
    b.jobId = job.id;
    b.jobBikeId = (await prisma.jobBike.create({ data: { shopId: B.id, jobId: job.id, make: "Trek", model: "Marlin 7", bikeId: b.bikeId, sortOrder: 0, catalogLookupAt: new Date() } })).id;
    b.completedJobId = (await prisma.job.create({ data: { shopId: B.id, bikeMake: "Trek", bikeModel: "Old", stage: "COMPLETED" } })).id;

    a.productId = (await prisma.product.create({ data: { shopId: A.id, name: "A's cassette", price: 50 } })).id;
    a.jobId = (await prisma.job.create({ data: { shopId: A.id, bikeMake: "Giant", bikeModel: "Talon", stage: "BOOKED_IN" } })).id;
    a.completedJobId = (await prisma.job.create({ data: { shopId: A.id, bikeMake: "Giant", bikeModel: "Done", stage: "COMPLETED" } })).id;
  });

  after(async () => {
    if (!prisma) return;
    // Shops cascade to their jobs, customers, bikes, users and products.
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) as string[] } } });
    await prisma.$disconnect();
  });

  it("Shop A can't read Shop B's job", async () => {
    const res = await jobRoute.GET(request("GET", `/api/jobs/${b.jobId}`, { host: A.host, as: A }), params(b.jobId));
    assert.equal(res.status, 404);
  });

  it("Shop A can't edit Shop B's job or remove its bike", async () => {
    const before = await snapshotB();
    const edit = await jobRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}`, { host: A.host, as: A, body: { notes: "pwned" } }),
      params(b.jobId)
    );
    assert.equal(edit.status, 404);
    const remove = await jobRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}`, { host: A.host, as: A, body: { removeJobBikeId: b.jobBikeId } }),
      params(b.jobId)
    );
    assert.equal(remove.status, 404);
    assert.deepEqual(await snapshotB(), before);
  });

  it("Shop A can't delete Shop B's job — but can delete its own", async () => {
    const res = await jobRoute.DELETE(request("DELETE", `/api/jobs/${b.jobId}`, { host: A.host, as: A }), params(b.jobId));
    assert.equal(res.status, 404);
    assert.ok(await prisma.job.findUnique({ where: { id: b.jobId } }));

    const own = await prisma.job.create({ data: { shopId: A.id, bikeMake: "Giant", bikeModel: "Throwaway" } });
    const ok = await jobRoute.DELETE(request("DELETE", `/api/jobs/${own.id}`, { host: A.host, as: A }), params(own.id));
    assert.equal(ok.status, 200);
    assert.equal(await prisma.job.findUnique({ where: { id: own.id } }), null);
  });

  it("A Shop A session can't be used on Shop B's host", async () => {
    const res = await jobRoute.DELETE(request("DELETE", `/api/jobs/${b.jobId}`, { host: B.host, as: A }), params(b.jobId));
    assert.equal(res.status, 401);
    assert.ok(await prisma.job.findUnique({ where: { id: b.jobId } }));
  });

  it("Archiving completed jobs only touches the caller's shop", async () => {
    const res = await archiveRoute.POST(request("POST", "/api/jobs/archive-completed", { host: A.host, as: A }));
    assert.equal(res.status, 200);
    const [mine, theirs] = await Promise.all([
      prisma.job.findUnique({ where: { id: a.completedJobId }, select: { archivedAt: true } }),
      prisma.job.findUnique({ where: { id: b.completedJobId }, select: { archivedAt: true } }),
    ]);
    assert.ok(mine?.archivedAt, "A's completed job archived");
    assert.equal(theirs?.archivedAt, null, "B's completed job untouched");
  });

  it("Reordering can't move Shop B's jobs, and a mixed list changes nothing", async () => {
    const before = await snapshotB();
    const own = await prisma.job.findUniqueOrThrow({ where: { id: a.jobId }, select: { columnSortOrder: true } });
    const res = await reorderRoute.POST(
      request("POST", "/api/jobs/reorder", {
        host: A.host,
        as: A,
        body: { updates: [{ id: a.jobId, columnSortOrder: 99 }, { id: b.jobId, columnSortOrder: 0 }] },
      })
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await snapshotB(), before);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: a.jobId }, select: { columnSortOrder: true } });
    assert.equal(after.columnSortOrder, own.columnSortOrder, "all or nothing");

    const ok = await reorderRoute.POST(
      request("POST", "/api/jobs/reorder", { host: A.host, as: A, body: { updates: [{ id: a.jobId, columnSortOrder: 7 }] } })
    );
    assert.equal(ok.status, 200);
  });

  it("Shop A can't add a product to Shop B's job", async () => {
    const res = await productsRoute.POST(
      request("POST", `/api/jobs/${b.jobId}/products`, { host: A.host, as: A, body: { productId: a.productId, quantity: 1 } }),
      params(b.jobId)
    );
    assert.equal(res.status, 404);
    assert.equal(await prisma.jobProduct.count({ where: { jobId: b.jobId } }), 0);
  });

  it("Shop A can't read or change Shop B's customer's notification preferences", async () => {
    const before = await snapshotB();
    const read = await prefsRoute.GET(request("GET", `/api/jobs/${b.jobId}/preferences`, { host: A.host, as: A }), params(b.jobId));
    assert.equal(read.status, 404);
    const write = await prefsRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}/preferences`, {
        host: A.host,
        as: A,
        body: { emailUpdatesConsent: false, smsConsent: true },
      }),
      params(b.jobId)
    );
    assert.equal(write.status, 404);
    assert.deepEqual(await snapshotB(), before);
  });

  it("SMS consent can't be changed without access to the job", async () => {
    const before = await snapshotB();
    const anonymous = await smsRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}/sms-consent`, { host: B.host, as: null, body: { smsConsent: false } }),
      params(b.jobId)
    );
    // Signed out, the auth helper falls back to NextAuth's getServerSession,
    // which needs Next's request context: inside Next that's "no session" →
    // 404; outside it (this test) it throws → 500. Either way it's refused,
    // and the snapshot below proves nothing changed.
    assert.notEqual(anonymous.status, 200);
    const otherShop = await smsRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}/sms-consent`, { host: A.host, as: A, body: { smsConsent: false } }),
      params(b.jobId)
    );
    assert.equal(otherShop.status, 404);
    assert.deepEqual(await snapshotB(), before);

    // Shop B's own staff still can.
    const own = await smsRoute.PATCH(
      request("PATCH", `/api/jobs/${b.jobId}/sms-consent`, { host: B.host, as: B, body: { smsConsent: true } }),
      params(b.jobId)
    );
    assert.equal(own.status, 200);
  });

  it("Shop A can't read, edit or delete Shop B's customer or bike", async () => {
    const before = await snapshotB();
    const cp = { params: Promise.resolve({ id: b.customerId }) };
    const bp = () => ({ params: Promise.resolve({ id: b.customerId, bikeId: b.bikeId }) });

    assert.equal((await customerRoute.GET(request("GET", `/api/customers/${b.customerId}`, { host: A.host, as: A }), cp)).status, 404);
    assert.equal(
      (
        await customerRoute.PATCH(
          request("PATCH", `/api/customers/${b.customerId}`, { host: A.host, as: A, body: { firstName: "Pwned" } }),
          { params: Promise.resolve({ id: b.customerId }) }
        )
      ).status,
      404
    );
    assert.equal(
      (await customerRoute.DELETE(request("DELETE", `/api/customers/${b.customerId}`, { host: A.host, as: A }), { params: Promise.resolve({ id: b.customerId }) })).status,
      404
    );
    assert.equal(
      (
        await customerBikeRoute.PATCH(
          request("PATCH", `/api/customers/${b.customerId}/bikes/${b.bikeId}`, { host: A.host, as: A, body: { model: "Pwned" } }),
          bp()
        )
      ).status,
      404
    );
    assert.equal(
      (await customerBikeRoute.DELETE(request("DELETE", `/api/customers/${b.customerId}/bikes/${b.bikeId}`, { host: A.host, as: A }), bp())).status,
      404
    );
    assert.deepEqual(await snapshotB(), before);
  });
});
