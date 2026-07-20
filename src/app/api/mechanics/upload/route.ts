import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];

function isHeicFile(file: File): boolean {
  return (
    /^image\/(heic|heif)$/i.test(file.type) ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

function isAllowedImage(file: File): boolean {
  if (ALLOWED_TYPES.includes(file.type)) return true;
  // iOS sometimes sends an empty MIME type for HEIC; fall back to extension.
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
}

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

    if (!isAllowedImage(file)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPEG, PNG, GIF, WebP, or HEIC." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large. Max size is ${MAX_SIZE_MB} MB.` },
        { status: 400 }
      );
    }

    const inputBytes = Buffer.from(await file.arrayBuffer());
    let uploadBytes: Buffer = inputBytes;
    let contentType = file.type || "application/octet-stream";
    let ext = (file.name.split(".").pop() || "jpg").toLowerCase();

    if (isHeicFile(file)) {
      try {
        // CommonJS package — require keeps Next from breaking the wasm decode path.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const convert = require("heic-convert") as (opts: {
          buffer: Buffer;
          format: "JPEG" | "PNG";
          quality?: number;
        }) => Promise<ArrayBuffer>;
        const jpegBuffer = Buffer.from(
          await convert({
            buffer: inputBytes,
            format: "JPEG",
            quality: 0.85,
          })
        );
        uploadBytes = jpegBuffer;
        contentType = "image/jpeg";
        ext = "jpg";
      } catch (error) {
        console.error("Mechanic HEIC conversion error:", error);
        return NextResponse.json(
          {
            error:
              "Failed to convert HEIC photo. Please export it as JPEG and try again.",
          },
          { status: 400 }
        );
      }
    }

    const path = `mechanics/${randomUUID()}.${ext}`;
    const blob = await put(path, uploadBytes, {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      contentType,
    });

    const url = blobDisplayUrl(blob.url, blob.pathname);
    return NextResponse.json(
      { url },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("Mechanic image upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
