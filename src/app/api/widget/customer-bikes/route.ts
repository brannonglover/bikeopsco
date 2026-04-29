import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";
import { getShopForHost } from "@/lib/shop";

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

    const { searchParams } = new URL(request.url);
    const firstName = searchParams.get("firstName")?.trim() ?? "";
    const lastName = searchParams.get("lastName")?.trim() ?? "";
    const email = searchParams.get("email")?.trim().toLowerCase() ?? "";

    if (!email && !firstName) {
      const res = NextResponse.json({ customer: null, bikes: [] });
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const customer = await prisma.customer.findFirst({
      where: email
        ? {
            shopId: shop.id,
            email: { equals: email, mode: "insensitive" },
          }
        : {
            shopId: shop.id,
            firstName: { equals: firstName, mode: "insensitive" },
            ...(lastName
              ? { lastName: { equals: lastName, mode: "insensitive" } }
              : { lastName: null }),
          },
      include: {
        bikes: {
          orderBy: [{ make: "asc" }, { model: "asc" }],
          select: {
            id: true,
            make: true,
            model: true,
            bikeType: true,
            nickname: true,
          },
        },
      },
    });

    const res = NextResponse.json({
      customer: customer
        ? {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
          }
        : null,
      bikes: customer?.bikes ?? [],
    });
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  } catch (error) {
    console.error("GET /api/widget/customer-bikes error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch customer bikes" },
      { status: 500 }
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
