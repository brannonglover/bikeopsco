import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowed =
    origin &&
    (origin.endsWith("basementbikemechanic.com") ||
      origin.endsWith(".basementbikemechanic.com") ||
      origin.includes("localhost"));
  response.headers.set("Vary", "Origin");
  if (allowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  return addCorsHeaders(res, origin);
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
      return addCorsHeaders(res, origin);
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
    return addCorsHeaders(res, origin);
  } catch (error) {
    console.error("GET /api/widget/customer-bikes error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch customer bikes" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}
