import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendJobEmail } from "@/lib/email";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);

    const jobs = await prisma.job.findMany({
      where: {
        stage: "COMPLETED",
        completedAt: { lte: threeDaysAgo },
        customer: { email: { not: null } },
      },
      include: { customer: true },
    });

    let sent = 0;
    for (const job of jobs) {
      const email = job.customer?.email;
      if (!email) continue;

      const alreadySent = await prisma.jobEmail.findFirst({
        where: {
          jobId: job.id,
          templateSlug: "follow_up_review",
        },
      });

      if (!alreadySent) {
        const result = await sendJobEmail("follow_up_review", email, job);
        if (result.ok) sent++;
      }
    }

    return NextResponse.json({ sent, total: jobs.length });
  } catch (error) {
    console.error("Cron send-follow-ups error:", error);
    return NextResponse.json(
      { error: "Failed to send follow-ups" },
      { status: 500 }
    );
  }
}
