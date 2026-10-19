import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken, type JWT } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { getShopForHost, type CurrentShop } from "@/lib/shop";
import { requestHost } from "@/lib/request-host";
import { isSessionCurrent } from "@/lib/session-version";

export type StaffShopAuth =
  | { ok: true; shop: CurrentShop; shopId: string; userId: string }
  | { ok: false; response: NextResponse };

export async function getRequestShop(request: NextRequest): Promise<CurrentShop | null> {
  const hostHeader =
    requestHost(request.headers);
  return getShopForHost(hostHeader);
}

/**
 * The staff session JWT (cookie or mobile Bearer), or null when there is none
 * or it was issued before the user's last password reset. Use this, never a
 * bare getToken, wherever a token authorizes anything.
 */
export async function getStaffToken(request: NextRequest): Promise<JWT | null> {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return null;
  return (await isSessionCurrent(token)) ? token : null;
}

/** Resolve staff shopId + userId from JWT cookie and/or NextAuth session (browser fallback). */
export async function resolveStaffShopId(
  request: NextRequest,
): Promise<{ shopId: string; userId: string } | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req: request, secret });
  if (typeof token?.shopId === "string" && typeof token?.id === "string") {
    // A revoked token is "no session": the fallback below would read the same cookie.
    if (!(await isSessionCurrent(token))) return null;
    return { shopId: token.shopId, userId: token.id };
  }

  // Fails closed: anything that stops the session being read (including a
  // call outside a request scope) is "no session", never an error to retry.
  const session = await getServerSession(authOptions).catch(() => null);
  if (typeof session?.user?.shopId === "string" && typeof session?.user?.id === "string") {
    return { shopId: session.user.shopId, userId: session.user.id };
  }

  return null;
}

export async function requireStaffShop(request: NextRequest): Promise<StaffShopAuth> {
  try {
    const resolved = await resolveStaffShopId(request);

    if (!resolved) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    const shop = await getRequestShop(request);
    if (!shop || shop.id !== resolved.shopId) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { ok: true, shop, shopId: resolved.shopId, userId: resolved.userId };
  } catch (error) {
    console.error("requireStaffShop error:", error);
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication failed" }, { status: 503 }),
    };
  }
}

/** Convenience for routes that only need the authorized shop id. */
export async function getAuthorizedShopId(request: NextRequest): Promise<string | null> {
  const auth = await requireStaffShop(request);
  return auth.ok ? auth.shopId : null;
}
