import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getToken } from "next-auth/jwt";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";

export const dynamic = "force-dynamic";

const MAX_SIZE_MB = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId || typeof token.shopId !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Logo upload is not configured. Add BLOB_READ_WRITE_TOKEN to your .env (Vercel Dashboard -> Storage -> Blob).",
      },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPEG, PNG, GIF, WebP, or SVG." },
        { status: 400 },
      );
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `File too large. Max size is ${MAX_SIZE_MB} MB.` }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const blob = await put(`branding/${token.shopId}/${randomUUID()}.${ext}`, file, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
    });

    return NextResponse.json(
      { url: blobDisplayUrl(blob.url, blob.pathname) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Logo upload error:", error);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}
