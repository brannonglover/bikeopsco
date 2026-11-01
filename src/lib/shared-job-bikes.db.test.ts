/**
 * Two bikes of the same make and model on one job are two bikes, through the
 * real routes against staging. Each keeps its own customer bike, so editing one
 * leaves the other alone and a repeat visit finds both.
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
  bike: typeof import("@/app/api/customers/[id]/bikes/[bikeId]/route");
  chatJob: typeof import("@/app/api/conversations/[id]/job/route");
  promote: typeof import("@/app/api/waitlist/[id]/promote/route");
};
let A: TestShop;

const newCustomer = (label: string) =>
  prisma.customer.create({
    data: { shopId: A.id, firstName: `${label} ${RUN}`, emailUpdatesConsent: false },
  });

const createChatJob = async (customerId: string, bikes: unknown[]) => {
  const conversation = await prisma.conversation.create({ data: { shopId: A.id, customerId } });
  const res = await R.chatJob.POST(
    request("POST", `/api/conversations/${conversation.id}/job`, { host: A.host, as: A, body: { bikes } }),
    { params: Promise.resolve({ id: conversation.id }) }
  );
  assert.ok(res.status === 200 || res.status === 201, `status ${res.status} ${await res.clone().text()}`);
  return prisma.job.findFirstOrThrow({
    where: { createdFromConversationId: conversation.id },
    include: { jobBikes: { orderBy: { sortOrder: "asc" } } },
  });
};

describe("same-model bikes on one job", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    R = {
      bike: await import("@/app/api/customers/[id]/bikes/[bikeId]/route"),
      chatJob: await import("@/app/api/conversations/[id]/job/route"),
      promote: await import("@/app/api/waitlist/[id]/promote/route"),
    };
    A = await createTestShop(prisma, `zzsb-${RUN}`);
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: A?.id } });
    await prisma.$disconnect();
  });

  it("a chat job with two identical bikes gives each its own customer bike", async () => {
    const customer = await newCustomer("Identical");
    const job = await createChatJob(customer.id, [
      { make: "Giant", model: "Roam" },
      { make: "Giant", model: "Roam" },
    ]);
    const [first, second] = job.jobBikes;
    assert.ok(first.bikeId && second.bikeId);
    assert.notEqual(first.bikeId, second.bikeId, "two bikes, two profile rows");
    assert.equal(await prisma.bike.count({ where: { customerId: customer.id } }), 2);
  });

  it("renaming one leaves the other, and the job still reads as two bikes", async () => {
    const customer = await newCustomer("Rename");
    const job = await createChatJob(customer.id, [
      { make: "Giant", model: "Roam" },
      { make: "Giant", model: "Roam" },
    ]);
    const bikeId = job.jobBikes[0].bikeId!;

    const res = await R.bike.PATCH(
      request("PATCH", `/api/customers/${customer.id}/bikes/${bikeId}`, {
        host: A.host,
        as: A,
        body: { make: "Specialized", model: "Hotrock" },
      }),
      { params: Promise.resolve({ id: customer.id, bikeId }) }
    );
    assert.equal(res.status, 200);

    const updated = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
      include: { jobBikes: { orderBy: { sortOrder: "asc" } } },
    });
    assert.deepEqual(
      updated.jobBikes.map((b) => `${b.make} ${b.model}`),
      ["Specialized Hotrock", "Giant Roam"]
    );
    assert.equal(updated.bikeMake, "Multiple", "a two-bike job keeps its summary");
    assert.equal(updated.bikeModel, "2 bikes");
  });

  it("the only bike on a job still refreshes the job's summary", async () => {
    const customer = await newCustomer("Single");
    const job = await createChatJob(customer.id, [{ make: "Giant", model: "Roam" }]);
    const bikeId = job.jobBikes[0].bikeId!;

    const res = await R.bike.PATCH(
      request("PATCH", `/api/customers/${customer.id}/bikes/${bikeId}`, {
        host: A.host,
        as: A,
        body: { model: "Escape" },
      }),
      { params: Promise.resolve({ id: customer.id, bikeId }) }
    );
    assert.equal(res.status, 200);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(updated.bikeMake, "Giant");
    assert.equal(updated.bikeModel, "Escape");
  });

  it("a repeat visit reuses both saved bikes and fills in a missing year", async () => {
    const customer = await newCustomer("Repeat");
    const first = await createChatJob(customer.id, [
      { make: "Giant", model: "Roam" },
      { make: "Giant", model: "Roam" },
    ]);
    const second = await createChatJob(customer.id, [
      { make: "Giant", model: "Roam", year: 2021 },
      { make: "Giant", model: "Roam" },
    ]);
    assert.deepEqual(
      second.jobBikes.map((b) => b.bikeId).sort(),
      first.jobBikes.map((b) => b.bikeId).sort(),
      "same two saved bikes, no new rows"
    );
    assert.equal(await prisma.bike.count({ where: { customerId: customer.id } }), 2);
    assert.equal(second.jobBikes[0].year, 2021);
    const saved = await prisma.bike.findUniqueOrThrow({ where: { id: second.jobBikes[0].bikeId! } });
    assert.equal(saved.year, 2021);
  });

  it("promoting a waitlist entry with two identical bikes keeps them apart", async () => {
    const customer = await newCustomer("Waitlist");
    const entry = await prisma.waitlistEntry.create({
      data: {
        shopId: A.id,
        customerId: customer.id,
        firstName: customer.firstName,
        lastName: "Test",
        email: `waitlist-${RUN}@example.test`,
        phone: "",
        bikes: {
          create: [
            { shopId: A.id, make: "Trek", model: "Marlin", sortOrder: 0 },
            { shopId: A.id, make: "Trek", model: "Marlin", sortOrder: 1 },
          ],
        },
      },
    });

    const res = await R.promote.POST(
      request("POST", `/api/waitlist/${entry.id}/promote`, { host: A.host, as: A }),
      { params: Promise.resolve({ id: entry.id }) }
    );
    assert.ok(res.status === 200 || res.status === 201, `status ${res.status} ${await res.clone().text()}`);

    const { promotedJobId } = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const jobBikes = await prisma.jobBike.findMany({ where: { jobId: promotedJobId! } });
    assert.equal(jobBikes.length, 2);
    assert.equal(new Set(jobBikes.map((b) => b.bikeId)).size, 2);
  });
});
