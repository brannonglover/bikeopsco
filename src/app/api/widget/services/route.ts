import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  return addWidgetCorsHeaders(res, origin, {
    methods: "GET, OPTIONS",
    allowHeaders: "Content-Type, Authorization",
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const hostHeader =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const shop = await getShopForHost(hostHeader);
    if (!shop) {
      const res = NextResponse.json({ error: "Shop not found" }, { status: 404 });
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const services = await prisma.service.findMany({
      where: { shopId: shop.id, isSystem: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, price: true },
    });

    const res = NextResponse.json(
      services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: Number(s.price),
      }))
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  } catch (error) {
    console.error("GET /api/widget/services error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 500 }
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
