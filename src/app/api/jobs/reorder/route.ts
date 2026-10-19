import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { publishJobEvent } from "@/lib/realtime/publish-job-event";

const reorderSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string(),
      columnSortOrder: z.number(),
    })
  ),
});

class JobNotInShopError extends Error {}

export async function POST(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { updates } = reorderSchema.parse(body);

    // Only this shop's jobs. If any id isn't one, nothing is reordered.
    await prisma.$transaction(async (tx) => {
      for (const { id, columnSortOrder } of updates) {
        const { count } = await tx.job.updateMany({
          where: { id, shopId: auth.shopId },
          data: { columnSortOrder },
        });
        if (count !== 1) throw new JobNotInShopError();
      }
    });

    // One event for the whole drag: the payload only identifies *a* changed
    // job, and subscribers refetch the entire board regardless.
    if (updates.length > 0) {
      await publishJobEvent("job:updated", { jobId: updates[0].id, shopId: auth.shopId });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (error instanceof JobNotInShopError) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("POST /api/jobs/reorder error:", error);
    return NextResponse.json({ error: "Failed to reorder jobs" }, { status: 500 });
  }
}
