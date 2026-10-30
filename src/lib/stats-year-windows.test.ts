/**
 * Stats that compare calendar years: Top 5 Services covers the current year,
 * and retention compares it with the same dates last year — through the real
 * route handler, over an in-memory stand-in for Prisma. Needs no database.
 *
 *   npm run test:stats
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encode } from "next-auth/jwt";
import { request, type TestShop } from "./test-support/route-harness";

const YEAR = new Date().getUTCFullYear();
const JAN_1 = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
const LAST_JAN_1_NOON = new Date(Date.UTC(YEAR - 1, 0, 1, 12, 0, 0));
const LAST_DEC_31 = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0) - 1000);

const SHOP = { id: "shop-1", name: "Test", subdomain: "zzstats" };
const USER = { id: "user-1", sessionVersion: 0 };

type PaidJob = { id: string; customerId: string; service: string; quantity: number; paidAt: Date[] };

const JOBS: PaidJob[] = [
  { id: "a", customerId: "regular", service: "Last Year Tune", quantity: 3, paidAt: [LAST_JAN_1_NOON] },
  { id: "b", customerId: "regular", service: "Flat Fix", quantity: 1, paidAt: [JAN_1] },
  { id: "c", customerId: "regular", service: "Paid Across Years", quantity: 7, paidAt: [LAST_JAN_1_NOON, JAN_1] },
  { id: "d", customerId: "december", service: "December Build", quantity: 5, paidAt: [LAST_DEC_31] },
  { id: "e", customerId: "first", service: "Flat Fix", quantity: 2, paidAt: [JAN_1] },
];

const fakePrisma = {
  shop: { findUnique: async () => SHOP },
  user: { findUnique: async () => USER },
  importedRevenue: { findMany: async () => [] },
  payment: {
    findMany: async () =>
      JOBS.flatMap((job) =>
        job.paidAt.map((createdAt) => ({
          jobId: job.id,
          amount: 10,
          status: "succeeded",
          createdAt,
          stripePaymentIntentId: null,
          paymentMethod: "cash",
          job: {
            customerId: job.customerId,
            jobBikes: [],
            receivedAt: null,
            createdAt,
            completedAt: null,
          },
        }))
      ),
  },
  jobService: {
    findMany: async ({ where }: { where: { jobId: { in: string[] } } }) =>
      JOBS.filter((job) => where.jobId.in.includes(job.id)).map((job) => ({
        service: null,
        customServiceName: job.service,
        quantity: job.quantity,
        unitPrice: 10,
      })),
  },
};

describe("stats year windows", () => {
  let body: {
    topServices: { name: string; count: number }[];
    retentionYearOverYear: {
      current: { calendarYear: number; newCustomers: number; returningCustomers: number; retentionRate: number };
      previous: { calendarYear: number; newCustomers: number; returningCustomers: number; retentionRate: number };
    };
  };

  before(async () => {
    process.env.NEXTAUTH_SECRET = "stats-test-secret";
    (globalThis as unknown as { prisma: unknown }).prisma = fakePrisma;
    const { GET } = await import("@/app/api/stats/route");

    const token = await encode({
      token: { id: USER.id, shopId: SHOP.id, shopSubdomain: SHOP.subdomain },
      secret: process.env.NEXTAUTH_SECRET,
    });
    const host = `${SHOP.subdomain}.${process.env.ROOT_DOMAIN ?? "bikeops.co"}`;
    const as: TestShop = {
      id: SHOP.id,
      subdomain: SHOP.subdomain,
      host,
      userId: USER.id,
      cookie: `next-auth.session-token=${token}`,
    };

    const res = await GET(request("GET", "/api/stats", { host, as }));
    assert.equal(res.status, 200);
    body = await res.json();
  });

  it("counts only jobs first paid this calendar year in Top 5 Services", () => {
    assert.deepEqual(
      body.topServices.map(({ name, count }) => ({ name, count })),
      [{ name: "Flat Fix", count: 3 }]
    );
  });

  it("compares retention with the same dates last year", () => {
    const { current, previous } = body.retentionYearOverYear;
    assert.deepEqual(current, { calendarYear: YEAR, newCustomers: 1, returningCustomers: 1, retentionRate: 50 });
    assert.deepEqual(previous, { calendarYear: YEAR - 1, newCustomers: 1, returningCustomers: 0, retentionRate: 0 });
  });
});
