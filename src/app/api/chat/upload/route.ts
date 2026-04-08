import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_SIZE_MB = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Image upload is not configured. Add BLOB_READ_WRITE_TOKEN to your .env.",
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

    const slug = file.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `chat/${slug}-${Date.now()}.${ext}`;

    const blob = await put(path, file, { access: BLOB_ACCESS, addRandomSuffix: true });
    const url = blobDisplayUrl(blob.url, blob.pathname);

    const attachment = await prisma.messageAttachment.create({
      data: {
        url,
        filename: file.name,
        mimeType: file.type,
      },
    });

    return NextResponse.json(attachment);
  } catch (error) {
    console.error("Chat upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
