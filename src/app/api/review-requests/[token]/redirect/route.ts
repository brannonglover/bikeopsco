import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params;
  const platform = request.nextUrl.searchParams.get("platform");

  if (platform !== "google" && platform !== "yelp") {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const reviewRequest = await prisma.reviewRequest.findUnique({
    where: { token },
  });

  if (!reviewRequest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const reviewSettings = await prisma.reviewSettings.findUnique({
    where: { id: "default" },
  });

  const destinationUrl =
    platform === "google"
      ? reviewSettings?.googleReviewUrl
      : reviewSettings?.yelpReviewUrl;

  if (!destinationUrl) {
    return NextResponse.json(
      { error: "Review URL not configured" },
      { status: 404 }
    );
  }

  try {
    if (platform === "google" && !reviewRequest.googleClickedAt) {
      await prisma.reviewRequest.update({
        where: { token },
        data: { googleClickedAt: new Date() },
      });
    } else if (platform === "yelp" && !reviewRequest.yelpClickedAt) {
      await prisma.reviewRequest.update({
        where: { token },
        data: { yelpClickedAt: new Date() },
      });
    }
  } catch {
    // Don't block the redirect if tracking fails
  }

  redirect(destinationUrl);
}
