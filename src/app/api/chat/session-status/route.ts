import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { customerHasSmsChatAccess } from "@/lib/chat-session";
import { getShopForHost } from "@/lib/shop";

/** Query params + DB — must run per request, not at build/static time. */
export const dynamic = "force-dynamic";

/**
 * Staff: Get a customer's active chat session expiry (for showing "X days left").
 */
export async function GET(request: NextRequest) {
  noStore();
  try {
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId required" }, { status: 400 });
    }

    const now = new Date();
    const activeJobSmsAccess = await customerHasSmsChatAccess(shop.id, customerId);

    const session = await prisma.chatSession.findFirst({
      where: { shopId: shop.id, customerId },
      orderBy: { expiresAt: "desc" },
    });

    if (activeJobSmsAccess) {
      return NextResponse.json({
        expiresAt: session?.expiresAt.toISOString() ?? null,
        pendingInvite: false,
        activeJobSmsAccess: true,
      });
    }

    if (session && session.expiresAt >= now) {
      return NextResponse.json({
        expiresAt: session.expiresAt.toISOString(),
        pendingInvite: false,
        activeJobSmsAccess: false,
      });
    }

    const pendingToken = await prisma.magicLinkToken.findFirst({
      where: { shopId: shop.id, customerId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      expiresAt: null,
      pendingInvite: !!pendingToken,
      pendingInviteSentAt: pendingToken?.createdAt.toISOString() ?? null,
      activeJobSmsAccess: false,
    });
  } catch (error) {
    console.error("GET /api/chat/session-status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session status" },
      { status: 500 }
    );
  }
}
