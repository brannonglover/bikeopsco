import { NextRequest, NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const CALLS_PAGE_SIZE = 100;

/** Global call history for the shop (known and unknown callers alike). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const features = await getAppFeatures(auth.shopId);
    if (!features.voiceEnabled) {
      return NextResponse.json({ error: "Voice is disabled" }, { status: 404 });
    }

    const calls = await prisma.call.findMany({
      where: { shopId: auth.shopId },
      orderBy: { createdAt: "desc" },
      take: CALLS_PAGE_SIZE,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    return NextResponse.json(calls);
  } catch (error) {
    console.error("GET /api/calls error:", error);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }
}
