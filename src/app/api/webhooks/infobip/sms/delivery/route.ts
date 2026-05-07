import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";

export const runtime = "nodejs";

const deliveryReportSchema = z.object({
  results: z
    .array(
      z.object({
        messageId: z.string().optional().nullable(),
        callbackData: z.string().optional().nullable(),
        doneAt: z.string().optional().nullable(),
        status: z
          .object({
            groupName: z.string().optional().nullable(),
            name: z.string().optional().nullable(),
            description: z.string().optional().nullable(),
          })
          .optional()
          .nullable(),
        error: z
          .object({
            name: z.string().optional().nullable(),
            description: z.string().optional().nullable(),
            groupName: z.string().optional().nullable(),
          })
          .optional()
          .nullable(),
      })
    )
    .default([]),
});

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.INFOBIP_WEBHOOK_SECRET?.trim();
  if (!expected) return true;

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");

  return provided === expected;
}

function parseInfobipDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDelivered(groupName: string | null | undefined, name: string | null | undefined): boolean {
  return groupName === "DELIVERED" || name === "DELIVERED_TO_HANDSET";
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    console.warn("Infobip SMS delivery webhook: invalid secret");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop) {
    console.warn("Infobip SMS delivery webhook: shop not found for host", hostHeader);
    return NextResponse.json({ received: true });
  }

  let payload: z.infer<typeof deliveryReportSchema>;
  try {
    payload = deliveryReportSchema.parse(await request.json());
  } catch (error) {
    console.warn("Infobip SMS delivery webhook: invalid payload", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  for (const report of payload.results) {
    const messageId = report.messageId?.trim();
    const callbackData = report.callbackData?.trim();
    if (!messageId && !callbackData) continue;

    const groupName = report.status?.groupName ?? null;
    const statusName = report.status?.name ?? null;
    const statusDescription = report.status?.description ?? null;
    const errorDescription =
      report.error?.description ?? report.error?.name ?? report.error?.groupName ?? null;

    await prisma.message.updateMany({
      where: {
        shopId: shop.id,
        OR: [
          ...(messageId ? [{ smsSid: messageId }] : []),
          ...(callbackData ? [{ id: callbackData }] : []),
        ],
      },
      data: {
        smsProvider: "infobip",
        smsSid: messageId ?? undefined,
        smsDeliveryStatus: groupName,
        smsDeliveryStatusName: statusName,
        smsDeliveryStatusDescription: statusDescription,
        smsDeliveryError: errorDescription,
        smsDeliveredAt: isDelivered(groupName, statusName)
          ? parseInfobipDate(report.doneAt) ?? new Date()
          : null,
      },
    });
  }

  return NextResponse.json({ received: true });
}
