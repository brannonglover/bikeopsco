import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getToken({ req: request });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
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

