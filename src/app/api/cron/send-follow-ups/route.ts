import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReviewRequestEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/env";

const TEMPLATE_SLUG = "follow_up_review";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);

    const [jobs, reviewSettings] = await Promise.all([
      prisma.job.findMany({
        where: {
          stage: "COMPLETED",
          completedAt: { lte: threeDaysAgo },
          customer: { email: { not: null } },
        },
        include: { customer: true },
      }),
      prisma.reviewSettings.findUnique({ where: { id: "default" } }),
    ]);

    const appUrl = getAppUrl();
    const googleReviewUrl = reviewSettings?.googleReviewUrl ?? null;
    const yelpReviewUrl = reviewSettings?.yelpReviewUrl ?? null;

    let sent = 0;
    for (const job of jobs) {
      const email = job.customer?.email;
      if (!email) continue;

      const alreadySent = await prisma.jobEmail.findFirst({
        where: { jobId: job.id, templateSlug: TEMPLATE_SLUG },
      });
      if (alreadySent) continue;

      // Create a ReviewRequest record for click tracking
      const reviewRequest = await prisma.reviewRequest.create({
        data: {
          recipientEmail: email,
          recipientName: job.customer
            ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || null
            : null,
          jobId: job.id,
          customerId: job.customer?.id ?? null,
        },
      });

      const base = appUrl
        ? `${appUrl}/api/review-requests/${reviewRequest.token}/redirect`
        : null;
      const googleTrackUrl = base && googleReviewUrl ? `${base}?platform=google` : null;
      const yelpTrackUrl = base && yelpReviewUrl ? `${base}?platform=yelp` : null;

      try {
        await sendReviewRequestEmail({
          recipientEmail: email,
          recipientName: reviewRequest.recipientName,
          googleTrackUrl,
          yelpTrackUrl,
        });

        // Record the send for deduplication
        await prisma.jobEmail.create({
          data: { jobId: job.id, templateSlug: TEMPLATE_SLUG, recipient: email },
        });

        sent++;
      } catch (emailError) {
        // Clean up the ReviewRequest if the send failed so it can be retried
        await prisma.reviewRequest.delete({ where: { id: reviewRequest.id } });
        console.error(`Failed to send follow-up for job ${job.id}:`, emailError);
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
