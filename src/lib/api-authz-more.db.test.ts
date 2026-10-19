/**
 * Tenant isolation for the remaining staff API areas: customer merge,
 * services, products, mechanics, rentals, waitlist, customer bikes — plus
 * indirect references (attaching another shop's customer) and the repair-
 * history deletion override. Real route handlers, real signed sessions for two
 * shops, against staging.
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
// Route modules, loaded after the env is set.
let R: {
  merge: typeof import("@/app/api/customers/[id]/merge/route");
  service: typeof import("@/app/api/services/[id]/route");
  product: typeof import("@/app/api/products/[id]/route");
  mechanics: typeof import("@/app/api/mechanics/route");
  mechanic: typeof import("@/app/api/mechanics/[id]/route");
  waitlistCancel: typeof import("@/app/api/waitlist/[id]/cancel/route");
  waitlist: typeof import("@/app/api/waitlist/route");
  fleet: typeof import("@/app/api/rentals/fleet/[id]/route");
  rate: typeof import("@/app/api/rentals/rates/[id]/route");
  addon: typeof import("@/app/api/rentals/addons/[id]/route");
  reservations: typeof import("@/app/api/rentals/reservations/route");
  reservation: typeof import("@/app/api/rentals/reservations/[id]/route");
  job: typeof import("@/app/api/jobs/[id]/route");
  customerBikes: typeof import("@/app/api/customers/[id]/bikes/route");
  customerBike: typeof import("@/app/api/customers/[id]/bikes/[bikeId]/route");
  customer: typeof import("@/app/api/customers/[id]/route");
};

let A: TestShop;
let B: TestShop;
const a: Record<string, string> = {};
const b: Record<string, string> = {};

const p = (id: string) => ({ params: { id } });
const pp = (id: string) => ({ params: Promise.resolve({ id }) });

/** Everything Shop B owns, as Shop B would see it — compared before and after each attack. */
async function snapshotB() {
  return {
    customers: await prisma.customer.findMany({ where: { shopId: B.id }, select: { id: true, firstName: true }, orderBy: { id: "asc" } }),
    bikes: await prisma.bike.findMany({ where: { OR: [{ shopId: B.id }, { customerId: { in: [b.customer, b.customer2] } }] }, select: { id: true, customerId: true, model: true }, orderBy: { id: "asc" } }),
    jobs: await prisma.job.findMany({ where: { shopId: B.id }, select: { id: true, customerId: true }, orderBy: { id: "asc" } }),
    service: await prisma.service.findUnique({ where: { id: b.service }, select: { name: true, price: true } }),
    product: await prisma.product.findUnique({ where: { id: b.product }, select: { name: true, price: true } }),
    mechanic: await prisma.mechanic.findUnique({ where: { id: b.mechanic }, select: { fullName: true } }),
    waitlist: await prisma.waitlistEntry.findUnique({ where: { id: b.waitlist }, select: { status: true, archivedAt: true } }),
    fleet: await prisma.rentalBike.findUnique({ where: { id: b.rentalBike }, select: { model: true } }),
    rate: await prisma.rentalRate.findUnique({ where: { id: b.rate }, select: { name: true } }),
    addon: await prisma.rentalAddon.findUnique({ where: { id: b.addon }, select: { name: true } }),
    reservation: await prisma.rentalReservation.findUnique({ where: { id: b.reservation }, select: { customerName: true } }),
  };
}

describe("tenant isolation: remaining staff APIs", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    R = {
      merge: await import("@/app/api/customers/[id]/merge/route"),
      service: await import("@/app/api/services/[id]/route"),
      product: await import("@/app/api/products/[id]/route"),
      mechanics: await import("@/app/api/mechanics/route"),
      mechanic: await import("@/app/api/mechanics/[id]/route"),
      waitlistCancel: await import("@/app/api/waitlist/[id]/cancel/route"),
      waitlist: await import("@/app/api/waitlist/route"),
      fleet: await import("@/app/api/rentals/fleet/[id]/route"),
      rate: await import("@/app/api/rentals/rates/[id]/route"),
      addon: await import("@/app/api/rentals/addons/[id]/route"),
      reservations: await import("@/app/api/rentals/reservations/route"),
      reservation: await import("@/app/api/rentals/reservations/[id]/route"),
      job: await import("@/app/api/jobs/[id]/route"),
      customerBikes: await import("@/app/api/customers/[id]/bikes/route"),
      customerBike: await import("@/app/api/customers/[id]/bikes/[bikeId]/route"),
      customer: await import("@/app/api/customers/[id]/route"),
    };

    A = await createTestShop(prisma, `zzta-${RUN}`);
    B = await createTestShop(prisma, `zztb-${RUN}`);

    for (const [shop, o] of [[A, a], [B, b]] as const) {
      o.customer = (await prisma.customer.create({ data: { shopId: shop.id, firstName: `C1 ${shop.subdomain}`, email: `c1-${shop.subdomain}@example.test` } })).id;
      o.customer2 = (await prisma.customer.create({ data: { shopId: shop.id, firstName: `C2 ${shop.subdomain}` } })).id;
      o.bike = (await prisma.bike.create({ data: { shopId: shop.id, customerId: o.customer2, make: "Trek", model: `Bike ${shop.subdomain}` } })).id;
      o.job = (await prisma.job.create({ data: { shopId: shop.id, customerId: o.customer2, bikeMake: "Trek", bikeModel: "X" } })).id;
      o.service = (await prisma.service.create({ data: { shopId: shop.id, name: `Svc ${shop.subdomain}`, price: 40 } })).id;
      o.product = (await prisma.product.create({ data: { shopId: shop.id, name: `Prod ${shop.subdomain}`, price: 20 } })).id;
      o.mechanic = (await prisma.mechanic.create({ data: { shopId: shop.id, fullName: `Mech ${shop.subdomain}` } })).id;
      o.waitlist = (await prisma.waitlistEntry.create({
        data: { shopId: shop.id, firstName: "W", lastName: "L", email: `w-${shop.subdomain}@example.test`, phone: "+15555550101", serviceIds: [] },
      })).id;
      o.rentalBike = (await prisma.rentalBike.create({ data: { shopId: shop.id, make: "Giant", model: `Rent ${shop.subdomain}` } })).id;
      o.rate = (await prisma.rentalRate.create({ data: { shopId: shop.id, name: `Rate ${shop.subdomain}`, days: 1, price: 30 } })).id;
      o.addon = (await prisma.rentalAddon.create({ data: { shopId: shop.id, name: `Addon ${shop.subdomain}`, price: 5 } })).id;
      o.reservation = (await prisma.rentalReservation.create({
        data: {
          shopId: shop.id,
          customerName: `Res ${shop.subdomain}`,
          rentalBikeId: o.rentalBike,
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-02"),
          days: 2,
          unitPrice: 30,
          totalPrice: 60,
        },
      })).id;
    }
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) as string[] } } });
    await prisma.$disconnect();
  });

  it("customer merge: can't pull in, or merge between, another shop's customers", async () => {
    const before = await snapshotB();
    const intoMine = await R.merge.POST(
      request("POST", `/api/customers/${a.customer}/merge`, { host: A.host, as: A, body: { sourceCustomerId: b.customer2 } }),
      pp(a.customer)
    );
    assert.equal(intoMine.status, 404);
    const theirs = await R.merge.POST(
      request("POST", `/api/customers/${b.customer}/merge`, { host: A.host, as: A, body: { sourceCustomerId: b.customer2 } }),
      pp(b.customer)
    );
    assert.equal(theirs.status, 404);
    assert.deepEqual(await snapshotB(), before);

    // Control: merging two of my own customers still works.
    const mine = await prisma.customer.create({ data: { shopId: A.id, firstName: "Dup" } });
    const ok = await R.merge.POST(
      request("POST", `/api/customers/${a.customer}/merge`, { host: A.host, as: A, body: { sourceCustomerId: mine.id } }),
      pp(a.customer)
    );
    assert.equal(ok.status, 200);
  });

  it("services and products: can't edit or delete another shop's", async () => {
    const before = await snapshotB();
    assert.equal((await R.service.PATCH(request("PATCH", `/api/services/${b.service}`, { host: A.host, as: A, body: { price: 0 } }), p(b.service))).status, 404);
    assert.equal((await R.service.DELETE(request("DELETE", `/api/services/${b.service}`, { host: A.host, as: A }), p(b.service))).status, 404);
    assert.equal((await R.product.PATCH(request("PATCH", `/api/products/${b.product}`, { host: A.host, as: A, body: { price: 0 } }), pp(b.product))).status, 404);
    assert.equal((await R.product.DELETE(request("DELETE", `/api/products/${b.product}`, { host: A.host, as: A }), pp(b.product))).status, 404);
    assert.deepEqual(await snapshotB(), before);

    assert.equal((await R.service.PATCH(request("PATCH", `/api/services/${a.service}`, { host: A.host, as: A, body: { price: 45 } }), p(a.service))).status, 200);
    assert.equal((await R.product.PATCH(request("PATCH", `/api/products/${a.product}`, { host: A.host, as: A, body: { price: 25 } }), pp(a.product))).status, 200);
  });

  it("mechanics: can't read, edit or delete another shop's", async () => {
    const before = await snapshotB();
    assert.equal((await R.mechanic.GET(request("GET", `/api/mechanics/${b.mechanic}`, { host: A.host, as: A }), pp(b.mechanic))).status, 404);
    assert.equal((await R.mechanic.PATCH(request("PATCH", `/api/mechanics/${b.mechanic}`, { host: A.host, as: A, body: { fullName: "Pwned" } }), pp(b.mechanic))).status, 404);
    assert.equal((await R.mechanic.DELETE(request("DELETE", `/api/mechanics/${b.mechanic}`, { host: A.host, as: A }), pp(b.mechanic))).status, 404);
    assert.deepEqual(await snapshotB(), before);
    const list = (await (await R.mechanics.GET(request("GET", "/api/mechanics", { host: A.host, as: A }))).json()) as Array<{ id: string }>;
    assert.ok(list.some((m) => m.id === a.mechanic) && !list.some((m) => m.id === b.mechanic));
  });

  it("waitlist: can't cancel another shop's entry, and listing shows only this shop's services", async () => {
    const before = await snapshotB();
    const res = await R.waitlistCancel.POST(request("POST", `/api/waitlist/${b.waitlist}/cancel`, { host: A.host, as: A }), pp(b.waitlist));
    assert.equal(res.status, 404);
    assert.deepEqual(await snapshotB(), before);

    // An entry of A's that (somehow) references B's service doesn't reveal its name.
    await prisma.waitlistEntry.update({ where: { id: a.waitlist }, data: { serviceIds: [a.service, b.service] } });
    const entries = (await (await R.waitlist.GET(request("GET", "/api/waitlist", { host: A.host, as: A }))).json()) as Array<{
      id: string;
      serviceNames: string[];
    }>;
    const mine = entries.find((e) => e.id === a.waitlist);
    assert.ok(mine, "A sees its own entry");
    assert.ok(!mine!.serviceNames.some((n) => n.includes(B.subdomain)), "no Shop B service name");

    assert.equal((await R.waitlistCancel.POST(request("POST", `/api/waitlist/${a.waitlist}/cancel`, { host: A.host, as: A }), pp(a.waitlist))).status, 200);
  });

  it("rentals: can't edit or delete another shop's fleet, rates, add-ons or reservations", async () => {
    const before = await snapshotB();
    const attempts = [
      R.fleet.PATCH(request("PATCH", `/api/rentals/fleet/${b.rentalBike}`, { host: A.host, as: A, body: { model: "Pwned" } }), pp(b.rentalBike)),
      R.fleet.DELETE(request("DELETE", `/api/rentals/fleet/${b.rentalBike}`, { host: A.host, as: A }), pp(b.rentalBike)),
      R.rate.PATCH(request("PATCH", `/api/rentals/rates/${b.rate}`, { host: A.host, as: A, body: { name: "Pwned" } }), pp(b.rate)),
      R.rate.DELETE(request("DELETE", `/api/rentals/rates/${b.rate}`, { host: A.host, as: A }), pp(b.rate)),
      R.addon.PATCH(request("PATCH", `/api/rentals/addons/${b.addon}`, { host: A.host, as: A, body: { name: "Pwned" } }), pp(b.addon)),
      R.addon.DELETE(request("DELETE", `/api/rentals/addons/${b.addon}`, { host: A.host, as: A }), pp(b.addon)),
      R.reservation.PATCH(request("PATCH", `/api/rentals/reservations/${b.reservation}`, { host: A.host, as: A, body: { customerName: "Pwned" } }), pp(b.reservation)),
      R.reservation.DELETE(request("DELETE", `/api/rentals/reservations/${b.reservation}`, { host: A.host, as: A }), pp(b.reservation)),
    ];
    for (const res of await Promise.all(attempts)) assert.equal(res.status, 404);
    assert.deepEqual(await snapshotB(), before);

    // Control: rentals are enabled and A can edit its own.
    const own = await R.addon.PATCH(request("PATCH", `/api/rentals/addons/${a.addon}`, { host: A.host, as: A, body: { name: "Mine" } }), pp(a.addon));
    assert.equal(own.status, 200);
  });

  it("indirect: can't attach another shop's customer to a reservation, a job, or a new bike", async () => {
    const before = await snapshotB();
    const create = await R.reservations.POST(
      request("POST", "/api/rentals/reservations", {
        host: A.host,
        as: A,
        body: { rentalBikeId: a.rentalBike, customerId: b.customer, customerName: "X", startDate: "2026-12-01", endDate: "2026-12-02" },
      })
    );
    assert.equal(create.status, 400);
    assert.equal(await prisma.rentalReservation.count({ where: { shopId: A.id, customerId: b.customer } }), 0);

    const reassign = await R.reservation.PATCH(
      request("PATCH", `/api/rentals/reservations/${a.reservation}`, { host: A.host, as: A, body: { customerId: b.customer } }),
      pp(a.reservation)
    );
    assert.equal(reassign.status, 400);

    const jobRes = await R.job.PATCH(
      request("PATCH", `/api/jobs/${a.job}`, { host: A.host, as: A, body: { customerId: b.customer } }),
      p(a.job)
    );
    assert.equal(jobRes.status, 400);
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: a.job } })).customerId, a.customer2);

    const bikeRes = await R.customerBikes.POST(
      request("POST", `/api/customers/${b.customer}/bikes`, { host: A.host, as: A, body: { make: "Trek", model: "Planted" } }),
      pp(b.customer)
    );
    assert.equal(bikeRes.status, 404);
    assert.deepEqual(await snapshotB(), before);
  });

  it("a session isn't usable on a host that isn't its shop's, including hosts that fall back to the default shop", async () => {
    // www.<root> has no shop subdomain, so it resolves to the default shop.
    // Middleware lets any session through there; the route must refuse.
    const res = await R.mechanics.GET(request("GET", "/api/mechanics", { host: "www.bikeops.co", as: A }));
    assert.equal(res.status, 401);
    const other = await R.mechanic.GET(request("GET", `/api/mechanics/${b.mechanic}`, { host: B.host, as: A }), pp(b.mechanic));
    assert.equal(other.status, 401);
  });

  it("the repair-history deletion override can't cross shops, and needs a reason", async () => {
    const before = await snapshotB();
    const q = "?confirmRepairHistoryDeletion=true&reason=Testing";
    const bike = await R.customerBike.DELETE(
      request("DELETE", `/api/customers/${b.customer2}/bikes/${b.bike}${q}`, { host: A.host, as: A }),
      { params: Promise.resolve({ id: b.customer2, bikeId: b.bike }) }
    );
    assert.equal(bike.status, 404);
    const customer = await R.customer.DELETE(request("DELETE", `/api/customers/${b.customer}${q}`, { host: A.host, as: A }), pp(b.customer));
    assert.equal(customer.status, 404);
    assert.deepEqual(await snapshotB(), before);

    const noReason = await R.customerBike.DELETE(
      request("DELETE", `/api/customers/${a.customer2}/bikes/${a.bike}?confirmRepairHistoryDeletion=true`, { host: A.host, as: A }),
      { params: Promise.resolve({ id: a.customer2, bikeId: a.bike }) }
    );
    assert.equal(noReason.status, 400);
    assert.ok(await prisma.bike.findUnique({ where: { id: a.bike } }));
  });
});
