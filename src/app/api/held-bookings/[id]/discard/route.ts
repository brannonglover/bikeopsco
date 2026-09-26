import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Confirm a held booking was spam.
 *
 * The row is archived rather than deleted. It never became a Customer or a
 * Job, so it is not cluttering anything, and keeping it means the submitting
 * IP and the signals that caught it are still there when the next wave
 * arrives — which is how you tell "the same bot came back" from "a new one".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const { shopId } = auth;

    const { id } = await params;

    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry || entry.shopId !== shopId || entry.archivedAt) {
      return NextResponse.json({ error: "Held booking not found" }, { status: 404 });
    }
    if (entry.status !== "HELD_FOR_REVIEW") {
      return NextResponse.json(
        { error: "This booking has already been reviewed" },
        { status: 400 }
      );
    }

    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: "CANCELLED",
        reviewedAt: new Date(),
        archivedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/held-bookings/[id]/discard error:", error);
    return NextResponse.json(
      { error: "Failed to discard the booking" },
      { status: 500 }
    );
  }
}
