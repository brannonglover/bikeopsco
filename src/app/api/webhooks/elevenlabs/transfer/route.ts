import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { redirectLiveCall } from "@/lib/voice";
import { hasValidToolSecret, verifyCallRef } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The phone assistant's transfer_to_staff tool.
 *
 * Moves the caller off the assistant and into the shop queue, where staff are
 * rung exactly as for any other call (see /api/webhooks/twilio/voice/ai-handoff).
 *
 * The answer goes back to the agent at once, but the redirect is held for a
 * moment: the assistant says "let me grab someone for you" in the same turn it
 * calls this, and redirecting immediately would cut that sentence off
 * mid-word, which sounds like a dropped call.
 */

/** Long enough for a short "one sec, let me grab someone" to finish playing. */
const REDIRECT_DELAY_MS = 3_000;

function toolResult(result: string, instructions: string) {
  // The agent reads this as the tool's output; `instructions` is what tells it
  // what to do next, so it is phrased to the agent, not the caller.
  return NextResponse.json({ result, instructions });
}

export async function POST(request: NextRequest) {
  const secret =
    request.headers.get("x-bikeops-tool-secret") ?? request.headers.get("authorization");
  if (!hasValidToolSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ref = verifyCallRef(
    request.headers.get("x-bikeops-call") ??
      (typeof body.call_ref === "string" ? body.call_ref : null)
  );
  if (!ref) {
    return NextResponse.json({ error: "Unknown call" }, { status: 400 });
  }

  const unavailable = () =>
    toolResult(
      "unavailable",
      "Nobody can take the call right now. Tell the caller kindly that everyone is tied up in the workshop, and offer to take a message for them instead. Do not try to transfer again."
    );

  // Second time round, the caller already waited for staff and nobody came.
  if (ref.mode !== "answer") return unavailable();

  const [call, settings] = await Promise.all([
    prisma.call.findFirst({
      where: { id: ref.callId, shopId: ref.shopId },
      select: { id: true, twilioParentCallSid: true, endedAt: true, aiHandoffAt: true },
    }),
    prisma.appSettings.findUnique({
      where: { shopId: ref.shopId },
      select: { voiceEnabled: true },
    }),
  ]);
  if (!call || call.endedAt) {
    return toolResult("ended", "The call has already ended. Say nothing more.");
  }
  if (!settings?.voiceEnabled) return unavailable();
  if (call.aiHandoffAt) {
    return toolResult("transferring", "The transfer is already under way. Say nothing more.");
  }

  const handoffUrl = `${ref.base}/api/webhooks/twilio/voice/ai-handoff`;
  waitUntil(
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, REDIRECT_DELAY_MS));
      await redirectLiveCall(call.twilioParentCallSid, handoffUrl).catch((error) => {
        // The caller most likely hung up in the pause. Nothing to clean up:
        // the assistant's conversation ends with the call either way.
        console.error("[voice-agent] transfer redirect failed:", {
          callId: call.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    })()
  );

  return toolResult(
    "transferring",
    "The caller is being connected to the shop now. Do not say anything else."
  );
}
