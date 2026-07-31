import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { blobDisplayUrl } from "@/lib/blob";
import {
  CHAT_ALLOWED_VIDEO_TYPES,
  isChatVideoMime,
} from "@/lib/chat-media";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().url(),
  pathname: z.string().min(1).max(500),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
});

function isAllowedBlobUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host.endsWith(".blob.vercel-storage.com") ||
      host === "blob.vercel-storage.com"
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const shop = await getShopForHost(request.headers.get("host"));
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }

  try {
    const parsed = bodySchema.parse(await request.json());

    if (!parsed.pathname.startsWith("chat/")) {
      return NextResponse.json({ error: "Invalid pathname" }, { status: 400 });
    }

    if (!isAllowedBlobUrl(parsed.url)) {
      return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
    }

    if (
      !isChatVideoMime(parsed.mimeType) ||
      !(CHAT_ALLOWED_VIDEO_TYPES as readonly string[]).includes(parsed.mimeType)
    ) {
      return NextResponse.json(
        { error: "Only MP4 or QuickTime video is supported." },
        { status: 400 }
      );
    }

    const url = blobDisplayUrl(parsed.url, parsed.pathname);

    const attachment = await prisma.messageAttachment.create({
      data: {
        shopId: shop.id,
        url,
        filename: parsed.filename,
        mimeType: parsed.mimeType,
      },
    });

    return NextResponse.json(attachment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error("Chat upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to save attachment" },
      { status: 500 }
    );
  }
}
