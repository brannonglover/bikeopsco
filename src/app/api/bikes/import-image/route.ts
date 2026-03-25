import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";

function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Image storage is not configured. Add BLOB_READ_WRITE_TOKEN to your environment (Vercel Dashboard → Storage → Blob). Online image search still needs Blob to save the chosen image.",
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json(
        { error: "No image URL provided" },
        { status: 400 }
      );
    }

    if (!isValidImageUrl(url)) {
      return NextResponse.json(
        { error: "Invalid image URL" },
        { status: 400 }
      );
    }

    const imageRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BikeOps/1.0; bike repair shop management)",
      },
    });

    if (!imageRes.ok) {
      return NextResponse.json(
        { error: "Could not fetch image" },
        { status: 400 }
      );
    }

    const contentType = imageRes.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "URL did not return a valid image" },
        { status: 400 }
      );
    }

    const ext =
      contentType.includes("png") ? "png"
      : contentType.includes("gif") ? "gif"
      : contentType.includes("webp") ? "webp"
      : "jpg";
    const blob = await put(
      `bikes/imported-${Date.now()}.${ext}`,
      await imageRes.arrayBuffer(),
      { access: BLOB_ACCESS }
    );

    const displayUrl = blobDisplayUrl(blob.url, blob.pathname);
    return NextResponse.json({ url: displayUrl });
  } catch (error) {
    console.error("Bike import image error:", error);
    return NextResponse.json(
      { error: "Failed to save image" },
      { status: 500 }
    );
  }
}
