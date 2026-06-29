import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { getShopForHost, type CurrentShop } from "@/lib/shop";

export type StaffShopAuth =
  | { ok: true; shop: CurrentShop; shopId: string }
  | { ok: false; response: NextResponse };

export async function getRequestShop(request: NextRequest): Promise<CurrentShop | null> {
  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return getShopForHost(hostHeader);
}

/** Resolve staff shopId from JWT cookie and/or NextAuth session (browser fallback). */
export async function resolveStaffShopId(request: NextRequest): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req: request, secret });
  if (typeof token?.shopId === "string") {
    return token.shopId;
  }

  const session = await getServerSession(authOptions);
  if (typeof session?.user?.shopId === "string") {
    return session.user.shopId;
  }

  return null;
}

export async function requireStaffShop(request: NextRequest): Promise<StaffShopAuth> {
  try {
    const tokenShopId = await resolveStaffShopId(request);

    if (!tokenShopId) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    const shop = await getRequestShop(request);
    if (!shop || shop.id !== tokenShopId) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { ok: true, shop, shopId: tokenShopId };
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
