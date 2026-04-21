import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";

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
            email: { equals: email, mode: "insensitive" },
          }
        : {
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
