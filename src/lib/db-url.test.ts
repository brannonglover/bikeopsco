import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONNECTION_LIMIT, normalizeDatabaseUrlForPrisma } from "./db-url";

const POOLER = "postgresql://u:p@aws-1-us-west-2.pooler.supabase.com:6543/postgres";

describe("normalizeDatabaseUrlForPrisma", () => {
  it("on the transaction pooler: pgbouncer mode, TLS, and the app's connection cap", () => {
    const url = new URL(normalizeDatabaseUrlForPrisma(POOLER)!);
    assert.equal(url.searchParams.get("pgbouncer"), "true");
    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.searchParams.get("connection_limit"), String(DEFAULT_CONNECTION_LIMIT.app));
  });

  it("more than one connection, so a request's side-by-side reads don't queue", () => {
    assert.ok(DEFAULT_CONNECTION_LIMIT.app > 1);
    assert.ok(DEFAULT_CONNECTION_LIMIT.catalog > 1);
  });

  it("takes a client's own cap (the catalog client's)", () => {
    const url = new URL(normalizeDatabaseUrlForPrisma(POOLER, { connectionLimit: DEFAULT_CONNECTION_LIMIT.catalog })!);
    assert.equal(url.searchParams.get("connection_limit"), String(DEFAULT_CONNECTION_LIMIT.catalog));
  });

  it("never overrides what the URL already sets", () => {
    const url = new URL(normalizeDatabaseUrlForPrisma(`${POOLER}?connection_limit=2&sslmode=verify-full`)!);
    assert.equal(url.searchParams.get("connection_limit"), "2");
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
  });

  it("leaves other ports (direct and session connections) alone", () => {
    const direct = "postgresql://u:p@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require";
    assert.equal(normalizeDatabaseUrlForPrisma(direct), direct);
  });
});
