import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Mark a call as seen in the log, which drops its "New" badge.
 *
 * The flag lives on the call rather than the customer because an unidentified
 * caller has no customer record to hang it on — that is the whole reason the
 * badge is there. Only ever set once, so the first look is what counts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;

    const updated = await prisma.call.updateMany({
      where: { id, shopId: auth.shopId, staffSeenAt: null },
      data: { staffSeenAt: new Date() },
    });

    return NextResponse.json({ ok: true, marked: updated.count > 0 });
  } catch (error) {
    console.error("POST /api/calls/[id]/seen error:", error);
    return NextResponse.json(
      { error: "Failed to mark call as seen" },
      { status: 500 }
    );
  }
}
