import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { sendQueuedCallerToVoicemail } from "@/lib/voice";

export const dynamic = "force-dynamic";

/**
 * Decline a ringing inbound call: drop the caller straight into voicemail
 * instead of leaving them on hold until the ring window expires.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const call = await prisma.call.findFirst({
      where: { shopId: auth.shopId, id, direction: "INBOUND" },
      select: { id: true, twilioParentCallSid: true, endedAt: true, answeredAt: true },
    });
    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    // Already over — declining is a no-op rather than an error, since the
    // caller may have hung up in the moment between ring and tap.
    //
    // `answeredAt` covers the other half of that: the ring goes to every
    // device, so a colleague can pick up while this one is still showing the
    // call. Redirecting then would pull a live conversation into voicemail
    // mid-sentence, which is why a call someone already took is left alone
    // rather than declined.
    if (call.endedAt || call.answeredAt) {
      return NextResponse.json({ ok: true, alreadyEnded: true });
    }

    const origin = request.nextUrl.origin;
    await sendQueuedCallerToVoicemail(
      call.twilioParentCallSid,
      `${origin}/api/webhooks/twilio/voice/voicemail`
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[voice] decline failed:", error);
    return NextResponse.json({ error: "Could not decline the call" }, { status: 500 });
  }
}
