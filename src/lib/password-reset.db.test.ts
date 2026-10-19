/**
 * Forgot-password links against staging: a link sets a new password once, only
 * on its own shop's host, and the request endpoint answers the same whether or
 * not the account exists.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let lib: typeof import("./password-reset");
let route: typeof import("@/app/api/auth/password-reset/route");

let A: TestShop;
let B: TestShop;

function reset(shop: TestShop, token: string, password: string) {
  return route.PUT(request("PUT", "/api/auth/password-reset", { host: shop.host, body: { token, password } }));
}

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  return bcrypt.compare(password, user.passwordHash);
}

describe("password reset", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    // Nothing leaves the building: the request endpoint's send is skipped.
    process.env.EMAIL_DISABLE = "true";
    ({ prisma } = await import("@/lib/db"));
    lib = await import("./password-reset");
    route = await import("@/app/api/auth/password-reset/route");
    A = await createTestShop(prisma, `pwa-${RUN}`);
    B = await createTestShop(prisma, `pwb-${RUN}`);
  });

  after(async () => {
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) } } });
  });

  it("answers a known and an unknown email identically", async () => {
    const known = await route.POST(
      request("POST", "/api/auth/password-reset", { host: A.host, body: { email: `pwa-${RUN}@example.test` } }),
    );
    const unknown = await route.POST(
      request("POST", "/api/auth/password-reset", { host: A.host, body: { email: `nobody-${RUN}@example.test` } }),
    );
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await known.json(), await unknown.json());
  });

  it("refuses a host that serves no shop", async () => {
    const res = await route.POST(
      request("POST", "/api/auth/password-reset", { host: "evil.example.com", body: { email: `pwa-${RUN}@example.test` } }),
    );
    assert.equal(res.status, 404);
  });

  it("sets the new password once, and only on the link's own shop", async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: A.userId } });
    const issued = await lib.issuePasswordResetToken(A.userId);
    assert.ok(issued.ok);

    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: A.userId } });
    assert.notEqual(stored.tokenHash, issued.token, "only a hash is stored");

    // Another shop's host can't spend it (and doesn't burn it).
    assert.equal((await reset(B, issued.token, "brand-new-pass")).status, 400);

    assert.equal((await reset(A, issued.token, "short")).status, 400);
    assert.equal((await reset(A, issued.token, "brand-new-pass")).status, 200);
    assert.ok(await passwordMatches(A.userId, "brand-new-pass"));

    // Single use.
    assert.equal((await reset(A, issued.token, "another-pass-1")).status, 400);
    assert.ok(await passwordMatches(A.userId, "brand-new-pass"));
  });

  it("rejects an expired link with 410", async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: B.userId } });
    const issued = await lib.issuePasswordResetToken(B.userId);
    assert.ok(issued.ok);
    await prisma.passwordResetToken.updateMany({
      where: { userId: B.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal((await reset(B, issued.token, "brand-new-pass")).status, 410);
  });

  it("throttles repeat requests for the same account", async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: B.userId } });
    assert.ok((await lib.issuePasswordResetToken(B.userId)).ok);
    const again = await lib.issuePasswordResetToken(B.userId);
    assert.deepEqual(again, { ok: false, reason: "throttled" });
  });

  it("treats an unknown token as invalid, not an error", async () => {
    assert.equal((await reset(A, "not-a-real-token", "brand-new-pass")).status, 400);
  });
});
