import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  extractPlaceIdFromUrl,
  resolveGoogleShortUrl,
  extractYelpAlias,
} from "@/lib/reviews";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const featuredReviewSchema = z.object({
  id: z.string(),
  platform: z.enum(["google", "yelp"]),
  author: z.string().max(80),
  text: z.string().max(500),
  rating: z.number().min(1).max(5),
});

const updateSchema = z.object({
  googleReviewUrl: z.string().url().or(z.literal("")).optional(),
  yelpReviewUrl: z.string().url().or(z.literal("")).optional(),
  googlePlaceId: z.string().optional(),
  featuredReviews: z.array(featuredReviewSchema).max(6).optional(),
});

function serializeSettings(settings: {
  googleReviewUrl: string | null;
  yelpReviewUrl: string | null;
  googlePlaceId: string | null;
  featuredReviews: unknown;
}) {
  return {
    googleReviewUrl: settings.googleReviewUrl ?? "",
    yelpReviewUrl: settings.yelpReviewUrl ?? "",
    googlePlaceId: settings.googlePlaceId ?? "",
    yelpAlias: extractYelpAlias(settings.yelpReviewUrl ?? "") ?? "",
    featuredReviews: Array.isArray(settings.featuredReviews) ? settings.featuredReviews : [],
  };
}

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.reviewsEnabled) {
      return NextResponse.json({ error: "Reviews are disabled" }, { status: 404 });
    }
    const settings = await prisma.reviewSettings.findUnique({
      where: { shopId: shop.id },
    });
    if (!settings) {
      return NextResponse.json({
        googleReviewUrl: "",
        yelpReviewUrl: "",
        googlePlaceId: "",
        yelpAlias: "",
        featuredReviews: [],
      });
    }
    return NextResponse.json(serializeSettings(settings));
  } catch (error) {
    console.error("GET /api/settings/review-links error:", error);
    return NextResponse.json(
      { error: "Failed to fetch review settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.reviewsEnabled) {
      return NextResponse.json({ error: "Reviews are disabled" }, { status: 404 });
    }
    const body = await request.json();
    const data = updateSchema.parse(body);

    // Auto-detect Google Place ID from the URL when not explicitly provided
    let resolvedPlaceId: string | null = data.googlePlaceId || null;
    if (!resolvedPlaceId && data.googleReviewUrl) {
      resolvedPlaceId =
        extractPlaceIdFromUrl(data.googleReviewUrl) ??
        (await resolveGoogleShortUrl(data.googleReviewUrl));
    }

    const settings = await prisma.reviewSettings.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        googleReviewUrl: data.googleReviewUrl || null,
        yelpReviewUrl: data.yelpReviewUrl || null,
        googlePlaceId: resolvedPlaceId,
        featuredReviews: data.featuredReviews ?? [],
      },
      update: {
        ...(data.googleReviewUrl !== undefined && {
          googleReviewUrl: data.googleReviewUrl || null,
        }),
        ...(data.yelpReviewUrl !== undefined && {
          yelpReviewUrl: data.yelpReviewUrl || null,
        }),
        // Always write resolved Place ID when URL changes; explicit "" clears it
        googlePlaceId:
          data.googlePlaceId === ""
            ? null
            : (resolvedPlaceId ?? undefined),
        ...(data.featuredReviews !== undefined && {
          featuredReviews: data.featuredReviews,
        }),
      },
    });

    return NextResponse.json(serializeSettings(settings));
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
