import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import {
  authenticateVoiceWebhook,
  buildDequeueTwiml,
  buildOutgoingCallTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
  parseStaffIdentity,
  hasRungOut,
  ringWindowCutoff,
  sendQueuedCallerToVoicemail,
  TWILIO_VOICE_NUMBER,
} from "@/lib/voice";

/** Call states that mean the caller could still be holding in the queue. */
const LIVE_STATUSES = ["QUEUED", "RINGING", "IN_PROGRESS"] as const;

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function sorryTwiml(): NextResponse {
  return xmlResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be completed.</Say><Hangup/></Response>'
  );
}

function spokenHangup(message: string): NextResponse {
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`
  );
}

/**
 * TwiML App Voice Request URL — hit when the mobile Voice SDK places an
 * outbound call via device.connect({ params: { To } }). Configure the same
 * shop-subdomain URL here as the number's /incoming webhook:
 * POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/outgoing
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const identity = parseStaffIdentity((params.From ?? "").replace(/^client:/, ""));
  const toRaw = params.To;

  // Answering an inbound call is technically an outbound leg: the device dials
  // into the shop queue and Twilio bridges it to whoever is holding. See
  // buildIncomingCallTwiml for why inbound no longer rings <Client> directly.
  if (params.Mode === "answer") {
    if (!identity || identity.shopId !== shop.id) {
      console.warn("Twilio Voice /outgoing: rejecting answer", {
        callSid,
        from: params.From,
        shopId: shop.id,
      });
      return sorryTwiml();
    }

    const base = getVoiceWebhookBaseUrl(request);

    // A notification can outlive the call it announced — the caller may have
    // hung up, timed out to voicemail, or been picked up by a colleague. This
    // is the only gate on joining the queue, so it decides answerability on
    // the server's own clock: a device with a slow push, a skewed clock or a
    // build that predates the ring deadline still cannot bridge into a queue
    // the caller has left.
    //
    // `answeredAt` is what rules out a call someone else already took. Status
    // cannot: an inbound caller's leg goes IN_PROGRESS the moment Twilio
    // answers it to run <Enqueue>, long before anyone picks up (see
    // /answered). Leaving it out would make every conversation lasting longer
    // than the ring window look like an expired caller below — and get it
    // redirected into voicemail mid-sentence.
    const holding = {
      shopId: shop.id,
      direction: "INBOUND" as const,
      status: { in: [...LIVE_STATUSES] },
      endedAt: null,
      answeredAt: null,
      ...(params.CallId ? { id: params.CallId } : {}),
    };
    // Oldest first because <Queue> bridges the longest-waiting caller: that is
    // the one an older app build, which sends no CallId to narrow this down,
    // would be handed.
    const oldestFirst = [{ startedAt: "asc" as const }, { createdAt: "asc" as const }];

    const now = new Date();
    const cutoff = ringWindowCutoff(now);
    const answerable = await prisma.call.findFirst({
      // Comparing in the query rather than reading a row and checking it here
      // keeps a caller who is out of time from ever being chosen — including
      // the no-CallId case, where a newer caller may still be answerable while
      // the longest-waiting one is not.
      where: {
        ...holding,
        OR: [
          { startedAt: { gt: cutoff } },
          { startedAt: null, createdAt: { gt: cutoff } },
        ],
      },
      orderBy: oldestFirst,
      select: { id: true },
    });

    if (!answerable) {
      // Nothing to bridge to. A row that is still live but out of time is a
      // caller the ring window has already given up on, and they are handed
      // to voicemail here rather than left holding: <Enqueue waitUrl> only
      // re-checks the window between documents, so without this they can sit
      // in the queue for a few seconds past their deadline — the very gap
      // that had staff dialing into an empty queue for ten seconds.
      const expired = await prisma.call.findFirst({
        where: holding,
        orderBy: oldestFirst,
        select: {
          id: true,
          startedAt: true,
          createdAt: true,
          twilioParentCallSid: true,
        },
      });
      if (!expired || !hasRungOut(expired.startedAt ?? expired.createdAt, now)) {
        // Nothing live at all, or it was closed out between the two queries.
        return spokenHangup("That call has already ended.");
      }

      // Claiming the row is the lock that makes repeated Answer taps safe:
      // only the attempt that wins this update redirects the caller, so a
      // second tap can't restart a voicemail greeting that is already
      // playing. NO_ANSWER is the honest interim state — nobody took the call
      // — and /voicemail overwrites it the moment the caller lands there.
      const claimed = await prisma.call.updateMany({
        where: {
          id: expired.id,
          status: { in: [...LIVE_STATUSES] },
          endedAt: null,
          answeredAt: null,
        },
        data: { status: "NO_ANSWER", endedAt: now },
      });
      if (claimed.count > 0) {
        await sendQueuedCallerToVoicemail(
          expired.twilioParentCallSid,
          `${base}/api/webhooks/twilio/voice/voicemail`
        ).catch((error) => {
          // The caller may have hung up, or /dequeued may have redirected them
          // a moment earlier. Either way the row is closed out above, and
          // anyone still holding leaves on /wait's next pass regardless.
          console.error("[voice] could not send an expired caller to voicemail:", error);
        });
      }
      return spokenHangup("That caller has gone to voicemail.");
    }

    return xmlResponse(
      buildDequeueTwiml({
        queueName: buildQueueName(shop.id),
        answeredUrl: `${base}/api/webhooks/twilio/voice/answered`,
      })
    );
  }

  if (!callSid || !toRaw || !identity || identity.shopId !== shop.id || !TWILIO_VOICE_NUMBER) {
    console.warn("Twilio Voice /outgoing: rejecting call", {
      callSid,
      from: params.From,
      to: toRaw,
      shopId: shop.id,
    });
    return sorryTwiml();
  }

  const toE164 = normalizePhone(toRaw) ?? toRaw;
  const customerId = await findCustomerIdBySmsFrom(shop.id, toE164);
  const conversation = customerId
    ? await findOrCreateGeneralConversation(shop.id, customerId)
    : null;

  await prisma.call.upsert({
    where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
    create: {
      shopId: shop.id,
      customerId,
      conversationId: conversation?.id ?? null,
      direction: "OUTBOUND",
      status: "QUEUED",
      fromNumber: TWILIO_VOICE_NUMBER,
      toNumber: toE164,
      twilioParentCallSid: callSid,
      startedAt: new Date(),
    },
    update: {},
  });

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildOutgoingCallTwiml({
    toNumber: toE164,
    callerId: TWILIO_VOICE_NUMBER,
    statusCallbackUrl: `${base}/api/webhooks/twilio/voice/status`,
  });

  return xmlResponse(twiml);
}
