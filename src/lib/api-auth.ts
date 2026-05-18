import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getShopForHost, type CurrentShop } from "@/lib/shop";

export type StaffShopAuth =
  | { ok: true; shop: CurrentShop; shopId: string }
  | { ok: false; response: NextResponse };

export async function getRequestShop(request: NextRequest): Promise<CurrentShop | null> {
  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return getShopForHost(hostHeader);
}

export async function requireStaffShop(request: NextRequest): Promise<StaffShopAuth> {
  const token = await getToken({ req: request });
  const tokenShopId = typeof token?.shopId === "string" ? token.shopId : null;

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
}
