import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { databaseDriver, pgPoolConfig, prismaDriverOptions } from "./db-driver";

const POOLER =
  "postgresql://postgres.ref:p%40ss@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require&connection_limit=5";

describe("databaseDriver", () => {
  it("is Prisma's engine unless DATABASE_DRIVER says pg", () => {
    // An undefined argument falls back to process.env, so clear it for this test.
    const before = process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_DRIVER;
    try {
      assert.equal(databaseDriver(), "prisma");
      assert.equal(databaseDriver(undefined), "prisma");
      assert.equal(databaseDriver(""), "prisma");
      assert.equal(databaseDriver("prisma"), "prisma");
      assert.equal(databaseDriver(" PG "), "pg");
    } finally {
      if (before !== undefined) process.env.DATABASE_DRIVER = before;
    }
  });

  it("refuses a value it doesn't know rather than guessing", () => {
    assert.throws(() => databaseDriver("postgres"), /DATABASE_DRIVER/);
  });
});

describe("pgPoolConfig", () => {
  it("keeps the URL's connection cap, credentials and database", () => {
    const config = pgPoolConfig(POOLER, 9);
    assert.equal(config.max, 5, "connection_limit from the URL, not the default");
    assert.equal(config.host, "aws-1-us-west-2.pooler.supabase.com");
    assert.equal(config.port, 6543);
    assert.equal(config.user, "postgres.ref");
    assert.equal(config.password, "p@ss");
    assert.equal(config.database, "postgres");
  });

  it("uses the client's default cap when the URL has none", () => {
    assert.equal(pgPoolConfig("postgresql://u:p@db.example.com:5432/app", 3).max, 3);
  });

  it("encrypts for sslmode=require as the engine does, and verifies only when asked", () => {
    assert.deepEqual(pgPoolConfig(POOLER, 5).ssl, { rejectUnauthorized: false });
    assert.deepEqual(pgPoolConfig(`${POOLER.split("?")[0]}?sslmode=verify-full`, 5).ssl, { rejectUnauthorized: true });
    assert.equal(pgPoolConfig("postgresql://u:p@localhost:5432/app", 5).ssl, undefined);
  });

  it("lets idle connections go, so a quiet instance holds none at the pooler", () => {
    assert.ok((pgPoolConfig(POOLER, 5).idleTimeoutMillis ?? 0) > 0);
  });
});

describe("prismaDriverOptions", () => {
  it("passes the URL to the engine by default (nothing else changes)", () => {
    const before = process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_DRIVER;
    try {
      assert.deepEqual(prismaDriverOptions(POOLER, 5), { datasources: { db: { url: POOLER } } });
      assert.deepEqual(prismaDriverOptions(undefined, 5), {});
    } finally {
      if (before !== undefined) process.env.DATABASE_DRIVER = before;
    }
  });

  it("gives an adapter instead of a URL when DATABASE_DRIVER=pg", () => {
    const before = process.env.DATABASE_DRIVER;
    process.env.DATABASE_DRIVER = "pg";
    try {
      const options = prismaDriverOptions(POOLER, 5);
      assert.ok(options.adapter, "adapter");
      assert.equal(options.datasources, undefined);
    } finally {
      if (before === undefined) delete process.env.DATABASE_DRIVER;
      else process.env.DATABASE_DRIVER = before;
    }
  });
});
