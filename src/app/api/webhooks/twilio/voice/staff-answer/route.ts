import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  authenticateVoiceWebhook,
  buildDequeueTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
  hasRungOut,
} from "@/lib/voice";
import { cancelStaffLegs, claimCallForLeg } from "@/lib/voice-legs";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function spokenHangup(message: string): NextResponse {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`
  );
}

/**
 * The answer URL of a staff leg — executed on that device's own leg the moment
 * the person accepts the invite, and the only place a leg is allowed to bridge.
 *
 * Everything that makes multi-device ringing safe happens here, in this order:
 * refuse a caller who has run out of hold, claim the call for exactly one leg,
 * and only then stop the others ringing. The claim is a conditional update, so
 * two devices accepting in the same instant produce one winner and one loser
 * however the requests interleave — without it both would run <Dial><Queue> and
 * the loser would sit on an empty queue for the dial timeout, which is the dead
 * air this design exists to remove.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop } = ctx;

  const legId = request.nextUrl.searchParams.get("legId");
  if (!legId) {
    console.warn("[voice] /staff-answer without a legId");
    return spokenHangup("Sorry, this call could not be completed.");
  }

  const leg = await prisma.callLeg.findFirst({
    where: { id: legId, call: { shopId: shop.id } },
    select: {
      id: true,
      status: true,
      call: {
        select: { id: true, startedAt: true, createdAt: true, endedAt: true },
      },
    },
  });
  if (!leg) {
    console.warn("[voice] /staff-answer for an unknown leg", { legId });
    return spokenHangup("Sorry, this call could not be completed.");
  }

  const call = leg.call;

  // The caller's clock, not the device's. A leg answered in the moment the hold
  // window closed must not bridge into a queue its caller has already left.
  if (call.endedAt || hasRungOut(call.startedAt ?? call.createdAt)) {
    await prisma.callLeg
      .update({ where: { id: leg.id }, data: { status: "ENDED" } })
      .catch(() => {});
    return spokenHangup("That caller has gone to voicemail.");
  }

  const won = await claimCallForLeg(call.id, leg.id);
  if (!won) {
    await prisma.callLeg
      .update({ where: { id: leg.id }, data: { status: "ENDED" } })
      .catch(() => {});
    return spokenHangup("Another member of staff picked up.");
  }

  await prisma.callLeg
    .update({ where: { id: leg.id }, data: { status: "ANSWERED" } })
    .catch(() => {});

  // Every other device stops ringing now rather than when the bridge completes:
  // the person who won is already talking to the caller, and a colleague's
  // phone still ringing behind that is the thing this replaces.
  await cancelStaffLegs(call.id, { exceptLegId: leg.id }).catch((error) => {
    // A ringing sibling is bad but survivable — its own `timeout` ends it at
    // the ring window. Failing the bridge over it would be worse.
    console.error("[voice] could not cancel sibling legs after an answer:", error);
  });

  const base = getVoiceWebhookBaseUrl(request);
  return xmlResponse(
    buildDequeueTwiml({
      queueName: buildQueueName(shop.id),
      answeredUrl: `${base}/api/webhooks/twilio/voice/answered`,
    })
  );
}
