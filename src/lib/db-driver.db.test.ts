/**
 * What the app relies on from its database clients, through Supabase's
 * transaction pooler: transactions, advisory locks, error codes, raw query
 * types, read-only transactions, and recovering from a dropped connection.
 * Runs against whichever clients @/lib/db and the catalog db provide, so the
 * same checks cover a change of driver (e.g. @prisma/adapter-pg).
 *
 *   npm run test:parts:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 * Writes only test catalog brands, deleted afterwards.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadTestEnv } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);
const MAKE = `Zzdr${RUN}`;

type AppClient = typeof import("@/lib/db")["prisma"];
type CatalogClient = typeof import("../../bike-catalog/lib/db")["catalogPrisma"];
let prisma: AppClient;
let catalogPrisma: CatalogClient;
let CatalogErrors: typeof import("../../bike-catalog/generated/client")["Prisma"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("database client behaviour", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    ({ catalogPrisma } = await import("../../bike-catalog/lib/db"));
    ({ Prisma: CatalogErrors } = await import("../../bike-catalog/generated/client"));
  });

  after(async () => {
    if (!catalogPrisma) return;
    await catalogPrisma.catalogBrand.deleteMany({ where: { name: { startsWith: MAKE } } });
  });

  it("an advisory transaction lock makes a second holder wait until the first commits", async () => {
    // The pattern conversation.ts and chat-sms.ts use to serialize per-thread work.
    const key = `test-lock-${RUN}`;
    const events: string[] = [];
    const holder = (name: string, holdMs: number) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          events.push(`${name} locked`);
          await sleep(holdMs);
          events.push(`${name} done`);
        },
        { timeout: 15_000 }
      );
    const first = holder("first", 1500);
    while (!events.includes("first locked")) await sleep(20);
    await Promise.all([first, holder("second", 0)]);
    assert.deepEqual(events, ["first locked", "first done", "second locked", "second done"]);
  });

  it("a rolled-back transaction releases its advisory lock", async () => {
    const key = `test-lock-rollback-${RUN}`;
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        throw new Error("rollback");
      })
    );
    const started = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    });
    assert.ok(Date.now() - started < 5000, "lock was free");
  });

  it("an interactive transaction that throws writes nothing", async () => {
    const slug = `${MAKE.toLowerCase()}-rollback`;
    await assert.rejects(
      catalogPrisma.$transaction(async (tx) => {
        await tx.catalogBrand.create({ data: { name: `${MAKE} Rollback`, slug } });
        assert.ok(await tx.catalogBrand.findUnique({ where: { slug } }), "visible inside the transaction");
        throw new Error("rollback");
      })
    );
    assert.equal(await catalogPrisma.catalogBrand.findUnique({ where: { slug } }), null);
  });

  it("a batch transaction is all or nothing, and a duplicate is a P2002 the lookup code can recognise", async () => {
    const slug = `${MAKE.toLowerCase()}-batch`;
    await catalogPrisma.catalogBrand.create({ data: { name: `${MAKE} Existing`, slug: `${slug}-taken` } });
    const error = await catalogPrisma
      .$transaction([
        catalogPrisma.catalogBrand.create({ data: { name: `${MAKE} Batch`, slug } }),
        catalogPrisma.catalogBrand.create({ data: { name: `${MAKE} Dup`, slug: `${slug}-taken` } }),
      ])
      .then(
        () => null,
        (e: unknown) => e
      );
    assert.ok(error instanceof CatalogErrors.PrismaClientKnownRequestError, "known request error");
    assert.equal((error as { code: string }).code, "P2002");
    assert.equal(await catalogPrisma.catalogBrand.findUnique({ where: { slug } }), null, "first create rolled back");
  });

  it("raw queries return the same JavaScript types", async () => {
    const [row] = await prisma.$queryRaw<
      Array<{ n: bigint; at: Date; amount: { toString(): string }; tags: string[]; flag: boolean; nothing: null }>
    >`SELECT count(*)::bigint AS n, now() AS at, 12.50::numeric AS amount, ARRAY['a','b']::text[] AS tags, true AS flag, NULL AS nothing`;
    assert.equal(typeof row.n, "bigint");
    assert.ok(row.at instanceof Date);
    assert.equal(row.amount.toString(), "12.5");
    assert.deepEqual(row.tags, ["a", "b"]);
    assert.equal(row.flag, true);
    assert.equal(row.nothing, null);
  });

  it("a read-only transaction refuses writes (the consolidation report relies on it)", async () => {
    await assert.rejects(
      catalogPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.catalogBrand.create({ data: { name: `${MAKE} ReadOnly`, slug: `${MAKE.toLowerCase()}-ro` } });
      }),
      /read-only|25006/
    );
  });

  it("many reads at once on both clients all complete", async () => {
    const reads = Array.from({ length: 20 }, (_, i) =>
      i % 2 ? prisma.shop.findFirst({ select: { id: true } }) : catalogPrisma.catalogBrand.findFirst({ select: { id: true } })
    );
    const results = await Promise.all(reads);
    assert.equal(results.length, 20);
  });

  it("a dropped server connection fails that query, and the next one works", async () => {
    // Ends the database session serving this transaction (staging only),
    // the way a network drop or a pooler restart would.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
      })
    );
    const shop = await prisma.shop.findFirst({ select: { id: true } });
    assert.ok(shop);
  });
});
