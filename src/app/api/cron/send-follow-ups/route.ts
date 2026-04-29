import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReviewRequestEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/env";

const WAVES = [
  { slug: "follow_up_review", delayDays: 3, followUpNumber: 1 as const },
  { slug: "follow_up_review_2", delayDays: 7, followUpNumber: 2 as const },
  { slug: "follow_up_review_3", delayDays: 14, followUpNumber: 3 as const },
];

/** Returns midnight UTC N days ago. */
function daysAgoMidnight(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results: Record<string, { sent: number; skipped: number }> = {};
    const shops = await prisma.shop.findMany({ select: { id: true, subdomain: true } });

    for (const wave of WAVES) {
      const threshold = daysAgoMidnight(wave.delayDays);

      let sent = 0;
      let skipped = 0;

      for (const shop of shops) {
        const reviewSettings = await prisma.reviewSettings.findUnique({
          where: { shopId: shop.id },
        });
        const googleReviewUrl = reviewSettings?.googleReviewUrl ?? null;
        const yelpReviewUrl = reviewSettings?.yelpReviewUrl ?? null;

        const appUrl =
          getAppUrl() ||
          (process.env.ROOT_DOMAIN
            ? `https://${shop.subdomain}.${process.env.ROOT_DOMAIN}`
            : "");

        const jobs = await prisma.job.findMany({
          where: {
            shopId: shop.id,
            stage: "COMPLETED",
            completedAt: { lte: threshold },
            customer: { email: { not: null } },
          },
          include: {
            customer: true,
            sentEmails: { select: { templateSlug: true } },
            reviewRequests: {
              select: { googleClickedAt: true, yelpClickedAt: true },
            },
          },
        });

        for (const job of jobs) {
          const email = job.customer?.email;
          if (!email) continue;

          // Skip if this wave was already sent for this job.
          if (job.sentEmails.some((e) => e.templateSlug === wave.slug)) {
            skipped++;
            continue;
          }

          // Skip if the customer has already clicked a review link for this job.
          const alreadyReviewed = job.reviewRequests.some(
            (r) => r.googleClickedAt || r.yelpClickedAt
          );
          if (alreadyReviewed) {
            skipped++;
            continue;
          }

          const reviewRequest = await prisma.reviewRequest.create({
            data: {
              shopId: shop.id,
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
              followUpNumber: wave.followUpNumber,
            });

            await prisma.jobEmail.create({
              data: { shopId: shop.id, jobId: job.id, templateSlug: wave.slug, recipient: email },
            });

            sent++;
          } catch (emailError) {
            await prisma.reviewRequest.delete({ where: { id: reviewRequest.id } });
            console.error(`[${wave.slug}] Failed to send for job ${job.id}:`, emailError);
          }
        }
      }

      results[wave.slug] = { sent, skipped };
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Cron send-follow-ups error:", error);
    return NextResponse.json({ error: "Failed to send follow-ups" }, { status: 500 });
  }
}
