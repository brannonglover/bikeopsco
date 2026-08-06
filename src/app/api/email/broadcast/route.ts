import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getBroadcastRecipients,
  listEmailBroadcastHistory,
  sendCustomerBroadcastEmails,
  sendCustomerBroadcastTestEmail,
} from "@/lib/email";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const postSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("test"),
    subject: z.string().min(1).max(200),
    bodyHtml: z.string().min(1).max(100_000),
    to: z.string().email(),
  }),
  z.object({
    mode: z.literal("send"),
    subject: z.string().min(1).max(200),
    bodyHtml: z.string().min(1).max(100_000),
    confirm: z.literal(true),
  }),
]);

/**
 * GET — eligible recipient count + recent broadcast history.
 */
export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const [recipients, history] = await Promise.all([
      getBroadcastRecipients(shop.id),
      listEmailBroadcastHistory(shop.id),
    ]);
    return NextResponse.json({
      recipientCount: recipients.length,
      sample: recipients.slice(0, 8).map((r) => ({
        id: r.id,
        email: r.email,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ").trim(),
      })),
      history,
    });
  } catch (e) {
    console.error("GET /api/email/broadcast", e);
    return NextResponse.json({ error: "Failed to load recipients" }, { status: 500 });
  }
}

/**
 * POST — test-send one broadcast email, or send to all consented customers.
 * Body is wrapped in the Bike Ops customer email shell at send time.
 */
export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const json = await request.json();
    const data = postSchema.parse(json);

    if (data.mode === "test") {
      const result = await sendCustomerBroadcastTestEmail(shop.id, {
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        to: data.to,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    const result = await sendCustomerBroadcastEmails(shop.id, {
      subject: data.subject,
      bodyHtml: data.bodyHtml,
    });

    if (result.error && result.sent === 0) {
      return NextResponse.json(
        {
          error: result.error,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
          errors: result.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: result.ok,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      errors: result.errors,
      broadcastId: result.broadcastId,
      historyId: result.historyId,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: e.flatten() }, { status: 400 });
    }
    console.error("POST /api/email/broadcast", e);
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 });
  }
}
