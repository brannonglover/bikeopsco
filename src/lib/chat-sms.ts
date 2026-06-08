import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import Twilio from "twilio";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

const MMS_MAX_SIZE_MB = 5;
const MMS_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const MMS_EXT_BY_MIME: Record<(typeof MMS_ALLOWED_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type TwilioInboundMedia = {
  url: string;
  contentType: string;
};

/**
 * URL Twilio used to POST (must match Console webhook URL). Override when
 * tunneling (ngrok) or if proxy host differs from the configured URL.
 */
export function getTwilioInboundWebhookUrl(request: NextRequest): string {
  const override = process.env.TWILIO_WEBHOOK_URL?.trim();
  if (override) return override;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return `${proto}://${host}${request.nextUrl.pathname}`;
}

export function validateTwilioWebhook(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  return Twilio.validateRequest(authToken, signature ?? "", url, params);
}

/** Match inbound SMS sender / customer.phone (stored formats vary). */
export async function findCustomerIdBySmsFrom(
  shopId: string,
  fromE164: string
): Promise<string | null> {
  const customers = await prisma.customer.findMany({
    where: { shopId, phone: { not: null } },
    select: { id: true, phone: true },
  });
  for (const c of customers) {
    if (!c.phone) continue;
    const n = normalizePhone(c.phone);
    if (n === fromE164) return c.id;
  }
  return null;
}

/** MediaUrl0 / MediaContentType0 … from Twilio inbound SMS/MMS webhooks. */
export function parseTwilioInboundMedia(
  params: Record<string, string>
): TwilioInboundMedia[] {
  const numMedia = parseInt(params.NumMedia ?? "0", 10) || 0;
  const items: TwilioInboundMedia[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`]?.trim();
    if (!url) continue;
    items.push({
      url,
      contentType:
        params[`MediaContentType${i}`]?.trim() ?? "application/octet-stream",
    });
  }
  return items;
}

/**
 * Download Twilio-hosted MMS media (URLs expire) and store in Blob as chat attachments.
 */
export async function importTwilioInboundMedia(
  shopId: string,
  media: TwilioInboundMedia[]
): Promise<{ id: string }[]> {
  if (media.length === 0) return [];

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    console.error(
      "Twilio MMS: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required to fetch media"
    );
    return [];
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "Twilio MMS: BLOB_READ_WRITE_TOKEN required to store inbound photos"
    );
    return [];
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const attachments: { id: string }[] = [];

  for (let i = 0; i < media.length; i++) {
    const { url, contentType } = media[i];
    if (
      !MMS_ALLOWED_TYPES.includes(
        contentType as (typeof MMS_ALLOWED_TYPES)[number]
      )
    ) {
      console.warn("Twilio MMS: skipping unsupported type", contentType);
      continue;
    }

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) {
        console.error("Twilio MMS: download failed", res.status, url);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MMS_MAX_SIZE_MB * 1024 * 1024) {
        console.warn("Twilio MMS: file too large", buffer.length);
        continue;
      }

      const ext =
        MMS_EXT_BY_MIME[contentType as (typeof MMS_ALLOWED_TYPES)[number]] ??
        "jpg";
      const path = `chat/sms-${randomUUID()}.${ext}`;
      const blob = await put(path, buffer, {
        access: BLOB_ACCESS,
        contentType,
        addRandomSuffix: false,
      });
      const displayUrl = blobDisplayUrl(blob.url, blob.pathname);
      const attachment = await prisma.messageAttachment.create({
        data: {
          shopId,
          url: displayUrl,
          filename: `photo-${i + 1}.${ext}`,
          mimeType: contentType,
        },
      });
      attachments.push({ id: attachment.id });
    } catch (e) {
      console.error("Twilio MMS: import failed", e);
    }
  }

  return attachments;
}

/** Most recently active thread, or a new general (no job) conversation. */
export async function findOrCreateConversationForInboundSms(
  shopId: string,
  customerId: string
) {
  const existing = await prisma.conversation.findFirst({
    where: { shopId, customerId, archived: false },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { shopId, customerId, jobId: null },
  });
}
