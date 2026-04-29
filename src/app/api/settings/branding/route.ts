import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { DEFAULT_BRANDING, getAppBranding, updateAppBranding } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  logoUrl: z
    .string()
    .trim()
    .refine((value) => value.startsWith("/api/blob") || z.string().url().safeParse(value).success, {
      message: "Logo URL must be a valid URL.",
    })
    .nullable(),
});

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  const shopId = typeof token?.shopId === "string" ? token.shopId : null;
  if (shopId) return NextResponse.json(await getAppBranding(shopId));

  const shop = await getShopForHost(request.headers.get("host"));
  if (!shop) return NextResponse.json(DEFAULT_BRANDING);

  return NextResponse.json(await getAppBranding(shop.id));
}

export async function PUT(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId || typeof token.shopId !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);
    return NextResponse.json(await updateAppBranding(token.shopId, data));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PUT /api/settings/branding error:", error);
    return NextResponse.json({ error: "Failed to update branding" }, { status: 500 });
  }
}
