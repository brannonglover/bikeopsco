import type { NextRequest } from "next/server";
import Twilio from "twilio";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

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
  fromE164: string
): Promise<string | null> {
  const customers = await prisma.customer.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  for (const c of customers) {
    if (!c.phone) continue;
    const n = normalizePhone(c.phone);
    if (n === fromE164) return c.id;
  }
  return null;
}

/** Most recently active thread, or a new general (no job) conversation. */
export async function findOrCreateConversationForInboundSms(
  customerId: string
) {
  const existing = await prisma.conversation.findFirst({
    where: { customerId, archived: false },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { customerId, jobId: null },
  });
}
