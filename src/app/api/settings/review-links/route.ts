import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await prisma.reviewSettings.findUnique({
      where: { id: "default" },
    });
    return NextResponse.json({
      googleReviewUrl: settings?.googleReviewUrl ?? "",
      yelpReviewUrl: settings?.yelpReviewUrl ?? "",
    });
  } catch (error) {
    console.error("GET /api/settings/review-links error:", error);
    return NextResponse.json(
      { error: "Failed to fetch review settings" },
      { status: 500 }
    );
  }
}

const updateSchema = z.object({
  googleReviewUrl: z.string().url().or(z.literal("")).optional(),
  yelpReviewUrl: z.string().url().or(z.literal("")).optional(),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    const settings = await prisma.reviewSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        googleReviewUrl: data.googleReviewUrl || null,
        yelpReviewUrl: data.yelpReviewUrl || null,
      },
      update: {
        ...(data.googleReviewUrl !== undefined && {
          googleReviewUrl: data.googleReviewUrl || null,
        }),
        ...(data.yelpReviewUrl !== undefined && {
          yelpReviewUrl: data.yelpReviewUrl || null,
        }),
      },
    });

    return NextResponse.json({
      googleReviewUrl: settings.googleReviewUrl ?? "",
      yelpReviewUrl: settings.yelpReviewUrl ?? "",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PUT /api/settings/review-links error:", error);
    return NextResponse.json(
      { error: "Failed to save review settings" },
      { status: 500 }
    );
  }
}
