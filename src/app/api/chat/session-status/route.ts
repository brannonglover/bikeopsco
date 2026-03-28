import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Query params + DB — must run per request, not at build/static time. */
export const dynamic = "force-dynamic";

/**
 * Staff: Get a customer's active chat session expiry (for showing "X days left").
 */
export async function GET(request: NextRequest) {
  try {
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId required" }, { status: 400 });
    }

    const session = await prisma.chatSession.findFirst({
      where: { customerId },
      orderBy: { expiresAt: "desc" },
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ expiresAt: null });
    }

    return NextResponse.json({ expiresAt: session.expiresAt.toISOString() });
  } catch (error) {
    console.error("GET /api/chat/session-status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session status" },
      { status: 500 }
    );
  }
}
