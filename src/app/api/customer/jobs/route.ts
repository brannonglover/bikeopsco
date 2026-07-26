import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";
import { getJobQueueInfo } from "@/lib/job-queue-position";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const shop = await requireCurrentShop();
  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }

  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const summary =
    searchParams.get("summary") === "1" ||
    searchParams.get("summary") === "true";

  // Home badge only needs stages — skip heavy includes + per-job queue work.
  if (summary) {
    const jobs = await prisma.job.findMany({
      where: { customerId, shopId: shop.id },
      select: { id: true, stage: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(jobs);
  }

  const jobs = await prisma.job.findMany({
    where: { customerId, shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { include: { bikes: true } },
      mechanic: { select: { id: true, fullName: true, imageUrl: true } },
      jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
      jobServices: { include: { service: true } },
      jobProducts: { include: { product: true } },
    },
  });

  const jobsWithQueue = await Promise.all(
    jobs.map(async (job) => ({
      ...job,
      queueInfo: await getJobQueueInfo(prisma, shop.id, job),
    }))
  );

  return NextResponse.json(jobsWithQueue);
}
