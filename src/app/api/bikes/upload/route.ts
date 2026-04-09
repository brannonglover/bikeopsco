import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";

export const dynamic = "force-dynamic";

const MAX_SIZE_MB = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Image upload is not configured. Add BLOB_READ_WRITE_TOKEN to your .env (Vercel Dashboard → Storage → Blob).",
      },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPEG, PNG, GIF, or WebP." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large. Max size is ${MAX_SIZE_MB} MB.` },
        { status: 400 }
      );
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `bikes/${randomUUID()}.${ext}`;

    const blob = await put(path, file, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
    });

    const url = blobDisplayUrl(blob.url, blob.pathname);
    return NextResponse.json({ url }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Bike image upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
