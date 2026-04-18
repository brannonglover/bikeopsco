import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

/**
 * Returns the customer's jobs when signed in via chat session.
 * Used to link from chat back to job status.
 */
export async function GET() {
  const features = await getAppFeatures();
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    where: {
      customerId,
      stage: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      bikeMake: true,
      bikeModel: true,
      stage: true,
    },
  });

  return NextResponse.json(jobs);
}
