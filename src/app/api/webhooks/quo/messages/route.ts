import { NextRequest, NextResponse } from "next/server";
import { processQuoMessageWebhook } from "@/lib/quo-webhook-process";
import type { QuoMessageWebhookPayload } from "@/lib/quo-webhook-process";
import { verifyQuoWebhookRequest } from "@/lib/quo-webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quo message webhooks → site chat widget sync.
 *
 * Quo app (Settings → Webhooks): use signing secret as QUO_WEBHOOK_SIGNING_KEY.
 * URL: https://app.bikeops.co/api/webhooks/quo/messages
 *
 * Optional manual testing: append ?secret=QUO_WEBHOOK_SECRET
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyQuoWebhookRequest(request, rawBody)) {
    console.warn("Quo webhook: unauthorized (check QUO_WEBHOOK_SIGNING_KEY or ?secret=)");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: QuoMessageWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as QuoMessageWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    const result = await processQuoMessageWebhook(payload);
    if (result.ok && result.action === "stored") {
      console.info("Quo webhook: stored message", payload.type, payload.data?.object?.id);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("Quo webhook process error:", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
