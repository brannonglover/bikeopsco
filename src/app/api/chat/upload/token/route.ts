import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { z } from "zod";
import { BLOB_ACCESS } from "@/lib/blob";
import {
  CHAT_ALLOWED_VIDEO_TYPES,
  CHAT_MAX_VIDEO_UPLOAD_MB,
  extensionForChatMedia,
  isChatVideoMime,
} from "@/lib/chat-media";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().optional(),
});

const TOKEN_TTL_MS = 30 * 60 * 1000;

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
          "Upload is not configured. Add BLOB_READ_WRITE_TOKEN to your .env.",
      },
      { status: 503 }
    );
  }

  try {
    const parsed = bodySchema.parse(await request.json());

    if (!isChatVideoMime(parsed.mimeType)) {
      return NextResponse.json(
        { error: "Only MP4 or QuickTime video is supported." },
        { status: 400 }
      );
    }

    if (
      !(CHAT_ALLOWED_VIDEO_TYPES as readonly string[]).includes(parsed.mimeType)
    ) {
      return NextResponse.json(
        { error: "Only MP4 or QuickTime video is supported." },
        { status: 400 }
      );
    }

    const maxBytes = CHAT_MAX_VIDEO_UPLOAD_MB * 1024 * 1024;
    if (parsed.size != null && parsed.size > maxBytes) {
      return NextResponse.json(
        { error: `Video too large. Max size is ${CHAT_MAX_VIDEO_UPLOAD_MB} MB.` },
        { status: 400 }
      );
    }

    const ext = extensionForChatMedia(parsed.filename, parsed.mimeType);
    const pathname = `chat/${randomUUID()}.${ext}`;

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: [...CHAT_ALLOWED_VIDEO_TYPES],
      maximumSizeInBytes: maxBytes,
      addRandomSuffix: false,
      validUntil: Date.now() + TOKEN_TTL_MS,
    });

    return NextResponse.json({
      clientToken,
      pathname,
      access: BLOB_ACCESS,
      maxSizeBytes: maxBytes,
      uploadUrl: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error("Chat upload token error:", error);
    return NextResponse.json(
      { error: "Failed to create upload token" },
      { status: 500 }
    );
  }
}
