import { NextRequest, NextResponse } from "next/server";
import { getStaffToken } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";
import { requestHost } from "@/lib/request-host";

export const dynamic = "force-dynamic";

async function getAuthorizedShopId(request: NextRequest): Promise<string | null> {
  const token = await getStaffToken(request);
  if (!token?.shopId || typeof token.shopId !== "string") return null;

  const hostHeader =
    requestHost(request.headers);
  const shop = await getShopForHost(hostHeader);
  if (!shop || shop.id !== token.shopId) return null;

  return shop.id;
}

export async function GET(request: NextRequest) {
  try {
    const shopId = await getAuthorizedShopId(request);
    if (!shopId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [totalSent, googleClicks, yelpClicks, anyClick] = await Promise.all([
      prisma.reviewRequest.count({ where: { shopId } }),
      prisma.reviewRequest.count({ where: { shopId, googleClickedAt: { not: null } } }),
      prisma.reviewRequest.count({ where: { shopId, yelpClickedAt: { not: null } } }),
      prisma.reviewRequest.count({
        where: {
          shopId,
          OR: [
            { googleClickedAt: { not: null } },
            { yelpClickedAt: { not: null } },
          ],
        },
      }),
    ]);

    return NextResponse.json({ totalSent, googleClicks, yelpClicks, anyClick });
  } catch (error) {
    console.error("GET /api/review-requests/stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch review stats" },
      { status: 500 }
    );
  }
}
