import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReviewRequestEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/env";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const requests = await prisma.reviewRequest.findMany({
      where: { shopId: shop.id },
      orderBy: { sentAt: "desc" },
      take: 100,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        job: { select: { id: true, bikeMake: true, bikeModel: true } },
      },
    });
    return NextResponse.json(requests);
  } catch (error) {
    console.error("GET /api/review-requests error:", error);
    return NextResponse.json(
      { error: "Failed to fetch review requests" },
      { status: 500 }
    );
  }
}

const sendSchema = z.object({
  jobId: z.string().optional(),
  customerId: z.string().optional(),
  email: z.string().email(),
  customerName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const data = sendSchema.parse(body);

    const reviewSettings = await prisma.reviewSettings.findUnique({
      where: { shopId: shop.id },
    });

    const googleReviewUrl = reviewSettings?.googleReviewUrl;
    const yelpReviewUrl = reviewSettings?.yelpReviewUrl;

    if (!googleReviewUrl && !yelpReviewUrl) {
      return NextResponse.json(
        {
          error:
            "No review URLs configured. Add your Google or Yelp review URL in Settings → Reviews.",
        },
        { status: 400 }
      );
    }

    const reviewRequest = await prisma.reviewRequest.create({
      data: {
        shopId: shop.id,
        recipientEmail: data.email,
        recipientName: data.customerName ?? null,
        jobId: data.jobId ?? null,
        customerId: data.customerId ?? null,
      },
    });

    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const appUrl = host ? `${proto}://${host}` : getAppUrl();
    const base = `${appUrl}/api/review-requests/${reviewRequest.token}/redirect`;
    const googleTrackUrl = googleReviewUrl ? `${base}?platform=google` : null;
    const yelpTrackUrl = yelpReviewUrl ? `${base}?platform=yelp` : null;

    await sendReviewRequestEmail({
      recipientEmail: data.email,
      recipientName: data.customerName ?? null,
      googleTrackUrl,
      yelpTrackUrl,
      shopId: shop.id,
    });

    // Prevent the day-3 cron wave from double-sending to this customer.
    if (data.jobId) {
      await prisma.jobEmail.create({
        data: {
          shopId: shop.id,
          jobId: data.jobId,
          templateSlug: "follow_up_review",
          recipient: data.email,
        },
      });
    }

    return NextResponse.json({ id: reviewRequest.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/review-requests error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send review request" },
      { status: 500 }
    );
  }
}
