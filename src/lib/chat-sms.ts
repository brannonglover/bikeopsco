import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import Twilio from "twilio";
import { BLOB_ACCESS, blobDisplayUrl } from "@/lib/blob";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import {
  buildSmsConsentUpdate,
  SMS_CONSENT_SOURCES,
} from "@/lib/sms-consent";

type Db = Prisma.TransactionClient;

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
  fromE164: string,
  tx?: Db
): Promise<string | null> {
  const client = tx ?? prisma;
  const customers = await client.customer.findMany({
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

/**
 * Resolve the sender of an inbound text, creating the customer when the number
 * isn't on file yet — a new customer texting the shop for the first time is the
 * common case, and without a profile there is nothing to hang the conversation
 * off, so the message would be dropped.
 *
 * The profile is named with the formatted number (same fallback label the voice
 * webhook uses for unknown callers) for staff to rename once they know who it
 * is, and records INBOUND_SMS consent: texting us first is prior express consent
 * to be answered.
 *
 * Takes the same advisory lock as conversation consolidation so two texts
 * arriving together can't create two profiles for one number.
 */
export async function findOrCreateCustomerIdForInboundSms(
  shopId: string,
  fromE164: string
): Promise<{ customerId: string; created: boolean }> {
  const existing = await findCustomerIdBySmsFrom(shopId, fromE164);
  if (existing) return { customerId: existing, created: false };

  return prisma.$transaction(async (tx) => {
    const lockKey = `${shopId}:${fromE164}:sms-customer`;
    // pg_advisory_xact_lock returns void — must use $executeRaw.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // Re-check under the lock: a concurrent inbound message may have won.
    const raced = await findCustomerIdBySmsFrom(shopId, fromE164, tx);
    if (raced) return { customerId: raced, created: false };

    const customer = await tx.customer.create({
      data: {
        shopId,
        firstName: formatPhoneDisplay(fromE164) || fromE164,
        phone: fromE164,
        // Staff fill in the real details from the thread with "Create contact".
        provisional: true,
        ...buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.INBOUND_SMS),
      },
      select: { id: true },
    });
    return { customerId: customer.id, created: true };
  });
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

export { findOrCreateGeneralConversation as findOrCreateConversationForInboundSms } from "@/lib/conversation";
