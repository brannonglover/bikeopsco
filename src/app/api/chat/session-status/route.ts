import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";

/** Query params + DB — must run per request, not at build/static time. */
export const dynamic = "force-dynamic";

/**
 * Staff: Get a customer's active chat session expiry (for showing "X days left").
 */
export async function GET(request: NextRequest) {
  noStore();
  try {
    const features = await getAppFeatures();
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId required" }, { status: 400 });
    }

    const now = new Date();

    const session = await prisma.chatSession.findFirst({
      where: { customerId },
      orderBy: { expiresAt: "desc" },
    });

    if (session && session.expiresAt >= now) {
      return NextResponse.json({ expiresAt: session.expiresAt.toISOString(), pendingInvite: false });
    }

    const pendingToken = await prisma.magicLinkToken.findFirst({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      expiresAt: null,
      pendingInvite: !!pendingToken,
      pendingInviteSentAt: pendingToken?.createdAt.toISOString() ?? null,
    });
  } catch (error) {
    console.error("GET /api/chat/session-status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session status" },
      { status: 500 }
    );
  }
}
