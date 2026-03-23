import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowed =
    origin &&
    (origin.endsWith("basementbikemechanic.com") ||
      origin.endsWith(".basementbikemechanic.com") ||
      origin.includes("localhost"));
  if (allowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = NextResponse.json({}, { status: 204 });
  return addCorsHeaders(res, origin);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const services = await prisma.service.findMany({
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
    return addCorsHeaders(res, origin);
  } catch (error) {
    console.error("GET /api/widget/services error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}
