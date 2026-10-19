import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";
import { requireStaffShop } from "@/lib/api-auth";
import { registerBlobAsset } from "@/lib/blob-access";
import { safeFetch, UnsafeUrlError } from "@/lib/safe-fetch";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The image type the bytes actually are; the server's Content-Type is only a claim. */
function sniffImage(bytes: Buffer): "jpg" | "png" | "gif" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") return "png";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" } as const;

export async function POST(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

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

    // The URL is the caller's choice and the request runs from our network:
    // safeFetch refuses private/internal addresses (at connect time, so DNS
    // rebinding can't slip past), re-checks every redirect, and caps size.
    let imageRes;
    try {
      imageRes = await safeFetch(url, {
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: 15_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BikeOps/1.0; bike repair shop management)",
          Accept: "image/*",
        },
      });
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
      }
      throw error;
    }

    if (imageRes.status < 200 || imageRes.status >= 300) {
      return NextResponse.json(
        { error: "Could not fetch image" },
        { status: 400 }
      );
    }

    const ext = sniffImage(imageRes.body);
    if (!ext) {
      return NextResponse.json(
        { error: "URL did not return a valid image" },
        { status: 400 }
      );
    }

    const blob = await put(
      `bikes/imported-${randomUUID()}.${ext}`,
      imageRes.body,
      { access: BLOB_ACCESS, addRandomSuffix: false, contentType: CONTENT_TYPES[ext] }
    );

    await registerBlobAsset({ pathname: blob.pathname, shopId: auth.shopId, kind: "bike" });
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
