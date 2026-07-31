import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";
import {
  CHAT_ALLOWED_IMAGE_TYPES,
  CHAT_MAX_IMAGE_UPLOAD_MB,
  extensionForChatMedia,
} from "@/lib/chat-media";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = CHAT_ALLOWED_IMAGE_TYPES as readonly string[];

export async function POST(request: NextRequest) {
  const shop = await getShopForHost(request.headers.get("host"));
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }
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
        {
          error:
            "Invalid file type for this upload. Use JPEG, PNG, GIF, or WebP. For video, use the video upload flow.",
        },
        { status: 400 }
      );
    }

    if (file.size > CHAT_MAX_IMAGE_UPLOAD_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large. Max size is ${CHAT_MAX_IMAGE_UPLOAD_MB} MB.` },
        { status: 400 }
      );
    }

    const ext = extensionForChatMedia(file.name, file.type);
    const path = `chat/${randomUUID()}.${ext}`;

    const blob = await put(path, file, { access: BLOB_ACCESS, addRandomSuffix: false });
    const url = blobDisplayUrl(blob.url, blob.pathname);

    const attachment = await prisma.messageAttachment.create({
      data: {
        shopId: shop.id,
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
