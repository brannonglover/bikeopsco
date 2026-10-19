import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const entry = await prisma.waitlistEntry.findFirst({ where: { id, shopId: auth.shopId } });
    if (!entry || entry.archivedAt) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
    }
    if (entry.status !== "WAITING") {
      return NextResponse.json({ error: "Waitlist entry is not waiting" }, { status: 400 });
    }

    await prisma.waitlistEntry.update({
      where: { id },
      data: { status: "CANCELLED", archivedAt: new Date() },
      select: { id: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/waitlist/[id]/cancel error:", error);
    return NextResponse.json({ error: "Failed to cancel waitlist entry" }, { status: 500 });
  }
}

