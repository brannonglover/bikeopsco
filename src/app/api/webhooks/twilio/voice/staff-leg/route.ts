import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook, getVoiceWebhookBaseUrl } from "@/lib/voice";
import { voicemailIfAllDeclined } from "@/lib/voice-legs";

export const runtime = "nodejs";

/**
 * Status callback for one staff leg — how the server learns what happened to a
 * device it rang.
 *
 * It matters that this is a Twilio callback rather than a call the app makes.
 * Rejecting an invite is often the last thing that happens before the app is
 * backgrounded or killed, and a decline reported by the device itself would be
 * lost exactly when someone declines and immediately pockets their phone. The
 * leg's own status reaches us either way.
 *
 * Declining is per-device on purpose: it silences this phone and leaves every
 * other one ringing. Only when the last live leg goes does the caller stop
 * holding for a shop that has collectively said no — see voicemailIfAllDeclined.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const legId = request.nextUrl.searchParams.get("legId");
  const rawStatus = params.CallStatus;
  if (!legId || !rawStatus) return new NextResponse("ok", { status: 200 });

  const leg = await prisma.callLeg.findFirst({
    where: { id: legId, call: { shopId: shop.id } },
    select: { id: true, callId: true, status: true },
  });
  if (!leg) {
    console.warn("[voice] /staff-leg for an unknown leg", { legId });
    return new NextResponse("ok", { status: 200 });
  }

  // A leg we already settled — answered, or swept by a cancel — must not be
  // walked backwards by a callback that arrives late.
  if (leg.status === "ANSWERED" || leg.status === "ENDED" || leg.status === "DECLINED") {
    return new NextResponse("ok", { status: 200 });
  }

  switch (rawStatus) {
    case "ringing":
      // Since March 2023 Twilio only emits this once the device has actually
      // received the push and connected, so it means "this phone is ringing"
      // rather than "a push was sent".
      if (leg.status === "PENDING") {
        await prisma.callLeg
          .update({ where: { id: leg.id }, data: { status: "RINGING" } })
          .catch(() => {});
      }
      return new NextResponse("ok", { status: 200 });

    case "in-progress":
      // The bridge itself is stamped by /staff-answer, which owns the claim.
      return new NextResponse("ok", { status: 200 });

    case "busy":
    case "no-answer":
    case "failed":
    case "completed":
    case "canceled": {
      // `busy` is how Twilio reports a rejected Client invite. It is recorded
      // distinctly because a declined leg must never be cancelled afterwards:
      // a cancel with no matching invite is what crashes the iOS SDK
      // (twilio-voice-react-native#722) and costs that device VoIP delivery.
      const declined = rawStatus === "busy";
      await prisma.callLeg
        .update({
          where: { id: leg.id },
          data: { status: declined ? "DECLINED" : "ENDED" },
        })
        .catch(() => {});

      // Only a leg that ended on the person's own terms can be the last
      // decline. A leg we cancelled ended because the call was already being
      // settled somewhere else, and re-deciding it here would race that.
      if (rawStatus === "canceled") return new NextResponse("ok", { status: 200 });

      await voicemailIfAllDeclined({
        callId: leg.callId,
        baseUrl: getVoiceWebhookBaseUrl(request),
      }).catch((error) => {
        // The caller still times out of the queue on /wait's own clock.
        console.error("[voice] could not settle an all-declined call:", error);
      });

      return new NextResponse("ok", { status: 200 });
    }

    default:
      return new NextResponse("ok", { status: 200 });
  }
}
