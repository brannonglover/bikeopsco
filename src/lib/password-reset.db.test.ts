/**
 * Forgot-password links against staging: a link sets a new password once, only
 * on its own shop's host, and the request endpoint answers the same whether or
 * not the account exists. A reset signs out every web and mobile login made
 * before it.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import { decode, encode, type JWT } from "next-auth/jwt";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let lib: typeof import("./password-reset");
let route: typeof import("@/app/api/auth/password-reset/route");
let mobileLogin: typeof import("@/app/api/auth/mobile-login/route");
let mechanics: typeof import("@/app/api/mechanics/route");
let reviewStats: typeof import("@/app/api/review-requests/stats/route");
let authOptions: typeof import("@/lib/auth")["authOptions"];
type JwtParams = Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["jwt"]>>[0];

let A: TestShop;
let B: TestShop;
let C: TestShop;

function reset(shop: TestShop, token: string, password: string) {
  return route.PUT(request("PUT", "/api/auth/password-reset", { host: shop.host, body: { token, password } }));
}

/** A staff route behind requireStaffShop, signed in with a cookie or a mobile Bearer token. */
async function mechanicsStatus(shop: TestShop, auth: { cookie: string } | { bearer: string }): Promise<number> {
  const headers: Record<string, string> =
    "cookie" in auth ? { cookie: auth.cookie } : { authorization: `Bearer ${auth.bearer}` };
  return (await mechanics.GET(request("GET", "/api/mechanics", { host: shop.host, headers }))).status;
}

/** A staff route that reads the JWT itself (getStaffToken). */
async function reviewStatsStatus(shop: TestShop, bearer: string): Promise<number> {
  const headers = { authorization: `Bearer ${bearer}` };
  return (await reviewStats.GET(request("GET", "/api/review-requests/stats", { host: shop.host, headers }))).status;
}

async function loginMobile(shop: TestShop, password: string): Promise<{ status: number; token?: string }> {
  const res = await mobileLogin.POST(
    request("POST", "/api/auth/mobile-login", { host: shop.host, body: { email: `${shop.subdomain}@example.test`, password } }),
  );
  const body = (await res.json()) as { token?: string };
  return { status: res.status, token: body.token };
}

/** The web sign-in: the credentials provider's authorize, then the jwt callback, as NextAuth runs them. */
async function loginWeb(shop: TestShop, password: string): Promise<string | null> {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (credentials: Record<string, string>, req: unknown) => Promise<unknown> };
  };
  const user = await provider.options.authorize(
    { email: `${shop.subdomain}@example.test`, password },
    { headers: { host: shop.host } },
  );
  if (!user) return null;
  const token = await authOptions.callbacks!.jwt!({ token: {}, user } as JwtParams);
  return `next-auth.session-token=${await encode({ token, secret: process.env.NEXTAUTH_SECRET! })}`;
}

/** What getServerSession and /api/auth/session do with an existing cookie. */
async function refreshWebSession(cookie: string): Promise<JWT> {
  const token = await decode({ token: cookie.split("=")[1], secret: process.env.NEXTAUTH_SECRET! });
  assert.ok(token);
  return authOptions.callbacks!.jwt!({ token } as JwtParams);
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
    mobileLogin = await import("@/app/api/auth/mobile-login/route");
    mechanics = await import("@/app/api/mechanics/route");
    reviewStats = await import("@/app/api/review-requests/stats/route");
    ({ authOptions } = await import("@/lib/auth"));
    A = await createTestShop(prisma, `pwa-${RUN}`);
    B = await createTestShop(prisma, `pwb-${RUN}`);
    C = await createTestShop(prisma, `pwc-${RUN}`);
  });

  after(async () => {
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id, C?.id].filter(Boolean) } } });
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

  it("signs out every existing web and mobile login, and a new login works", async () => {
    await prisma.user.update({
      where: { id: C.userId },
      data: { passwordHash: await bcrypt.hash("old-password-1", 4) },
    });

    // Before: the harness cookie (issued with no version, like every session
    // from before this change) and a fresh mobile login both work.
    const mobile = await loginMobile(C, "old-password-1");
    assert.equal(mobile.status, 200);
    const oldBearer = mobile.token!;
    assert.equal(await mechanicsStatus(C, { cookie: C.cookie }), 200);
    assert.equal(await mechanicsStatus(C, { bearer: oldBearer }), 200);
    assert.equal(await reviewStatsStatus(C, oldBearer), 200);
    await refreshWebSession(C.cookie);

    await prisma.passwordResetToken.deleteMany({ where: { userId: C.userId } });
    const issued = await lib.issuePasswordResetToken(C.userId);
    assert.ok(issued.ok);
    assert.equal((await reset(C, issued.token, "new-password-1")).status, 200);

    // After: both old logins are refused by the API...
    assert.equal(await mechanicsStatus(C, { cookie: C.cookie }), 401);
    assert.equal(await mechanicsStatus(C, { bearer: oldBearer }), 401);
    assert.equal(await reviewStatsStatus(C, oldBearer), 401);
    // ...and the browser's session read fails, so NextAuth clears the cookie
    // and the page goes to /login.
    await assert.rejects(refreshWebSession(C.cookie), /Session revoked/);

    // The old password no longer signs in; the new one does, on web and mobile.
    assert.equal((await loginMobile(C, "old-password-1")).status, 401);
    assert.equal(await loginWeb(C, "old-password-1"), null);

    const fresh = await loginMobile(C, "new-password-1");
    assert.equal(fresh.status, 200);
    assert.equal(await mechanicsStatus(C, { bearer: fresh.token! }), 200);
    assert.equal(await reviewStatsStatus(C, fresh.token!), 200);

    const webCookie = await loginWeb(C, "new-password-1");
    assert.ok(webCookie);
    assert.equal(await mechanicsStatus(C, { cookie: webCookie }), 200);
    await refreshWebSession(webCookie);
  });

  it("treats an unknown token as invalid, not an error", async () => {
    assert.equal((await reset(A, "not-a-real-token", "brand-new-pass")).status, 400);
  });
});
