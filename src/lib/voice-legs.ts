import "server-only";

import Twilio from "twilio";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  RING_SECONDS,
  buildStaffIdentity,
  sendQueuedCallerToVoicemail,
  TWILIO_VOICE_NUMBER,
} from "@/lib/voice";

/**
 * Ringing staff with real Twilio Client invites, rather than a repeated push.
 *
 * The caller side is untouched: they are still parked in the shop queue by
 * <Enqueue>. What changes is how staff are alerted — each registered device is
 * rung by its own outbound call to `client:<identity>`, which Twilio delivers as
 * a VoIP push, so the OS shows its own incoming-call screen and rings until
 * someone acts. Answering bridges that leg into the queue the caller is already
 * holding in, which is why none of the queue TwiML had to change.
 *
 * The cost of a real ring is that it no longer stops by itself. A push that is
 * never sent again is a ring that ends; a live Twilio leg rings until something
 * cancels it. Every path that settles a call therefore has to sweep the legs it
 * leaves behind — see cancelStaffLegs, and the four callers of it.
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? null;
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? null;

/** Leg states that mean a device could still be ringing. */
const LIVE_LEG_STATUSES = ["PENDING", "RINGING"] as const;

/**
 * Twilio's limits on custom parameters passed through the `To` query string:
 * at most 8, names <= 32 bytes, values <= 128 bytes. Only two are sent, but the
 * caller's name is free text and has to be cut to fit.
 */
const MAX_PARAM_VALUE_BYTES = 128;

function twilioClient() {
  if (!accountSid || !authToken) throw new Error("Twilio is not configured");
  return Twilio(accountSid, authToken);
}

/** Trims a custom-parameter value to Twilio's byte limit, not its length. */
function fitParamValue(value: string): string {
  let out = value;
  while (Buffer.byteLength(out, "utf8") > MAX_PARAM_VALUE_BYTES) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * A Twilio REST error that means "this leg is already gone". Cancelling a call
 * that has ended is the expected outcome of every race this module has, so it
 * is a success rather than something to retry or report.
 */
function isAlreadyGone(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const code = (error as { code?: number })?.code;
  // 404: no such call. 20009 / 21220: not in a state that can be cancelled.
  return status === 404 || code === 20404 || code === 20009 || code === 21220;
}

/**
 * Whether the staff app on the other end can be rung with Client invites.
 *
 * Off, and deliberately not a per-shop decision. Invites ring a device only if
 * that device called voice.register(), and the staff app stopped doing so when
 * inbound calls moved back to this app's own call screen: iOS forces a PushKit
 * call onto the native CallKit UI, so registering is exactly what took the
 * call out of BikeOps and put it in the system phone app.
 *
 * This being a constant rather than the shop flag is the point. A shop left on
 * `voiceNativeRingEnabled` once the app no longer registers is the worst of
 * both paths: fanOutStaffLegs dials one leg per staff user whether or not any
 * device is listening, /wait sends no push because it believes the phones are
 * already ringing, and the caller holds in silence until voicemail takes them
 * — with nothing in the logs that looks like a failure.
 *
 * Going back to native ringing therefore takes two commits, not a settings
 * toggle: flip this, and ship a staff build that registers again.
 */
const NATIVE_RING_SUPPORTED_BY_APP: boolean = false;

/** Whether this shop rings staff with Client invites rather than a push. */
export async function isNativeRingEnabled(shopId: string): Promise<boolean> {
  if (!NATIVE_RING_SUPPORTED_BY_APP) return false;
  const settings = await prisma.appSettings.findUnique({
    where: { shopId },
    select: { voiceNativeRingEnabled: true },
  });
  return settings?.voiceNativeRingEnabled ?? false;
}

/**
 * Rings every staff device for a call that has just been parked in the queue.
 *
 * One outbound call per identity. Each carries the ids both callbacks need in
 * its own URLs, so nothing has to be looked up by SID to know which leg a
 * callback is about.
 *
 * `timeout` is the backstop: if every cancellation path below were to fail,
 * Twilio still stops ringing the device at the end of the caller's own hold
 * window, so no device is left ringing for a caller who has gone.
 */
export async function fanOutStaffLegs(opts: {
  shopId: string;
  callId: string;
  baseUrl: string;
  fromNumber: string;
  customerName?: string | null;
}): Promise<number> {
  const { shopId, callId, baseUrl, fromNumber, customerName } = opts;
  if (!TWILIO_VOICE_NUMBER) throw new Error("Twilio voice number is not configured");
  // Captured locally: the narrowing above is lost inside the per-leg closure,
  // because an imported binding could in principle change between the two.
  const callerId = TWILIO_VOICE_NUMBER;

  const users = await prisma.user.findMany({ where: { shopId }, select: { id: true } });
  if (users.length === 0) return 0;

  const callerLabel = fitParamValue(
    customerName?.trim() || formatPhoneDisplay(fromNumber) || "Unknown caller"
  );

  const client = twilioClient();
  let rung = 0;

  await Promise.all(
    users.map(async (user) => {
      const identity = buildStaffIdentity(shopId, user.id);
      // The row first: its id goes in both callback URLs, so it has to exist
      // before Twilio is asked to create anything.
      const leg = await prisma.callLeg.create({
        data: { callId, identity, status: "PENDING" },
        select: { id: true },
      });

      // Custom parameters ride in the `To` query string — Twilio's documented
      // route for REST-created Client calls, read on the device as
      // callInvite.customParameters. This is what lets the app show the right
      // caller and, on answer, open the right call.
      const params = new URLSearchParams({ callId, name: callerLabel });
      const to = `client:${identity}?${params.toString()}`;

      try {
        const created = await client.calls.create({
          to,
          from: callerId,
          url: `${baseUrl}/api/webhooks/twilio/voice/staff-answer?legId=${leg.id}`,
          method: "POST",
          statusCallback: `${baseUrl}/api/webhooks/twilio/voice/staff-leg?legId=${leg.id}`,
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          statusCallbackMethod: "POST",
          timeout: RING_SECONDS,
        });
        await prisma.callLeg.update({
          where: { id: leg.id },
          data: { callSid: created.sid, status: "RINGING" },
        });
        rung += 1;
      } catch (error) {
        // One unreachable device must not stop the others ringing.
        console.error("[voice] could not ring staff leg", { identity, error });
        await prisma.callLeg
          .update({ where: { id: leg.id }, data: { status: "ENDED" } })
          .catch(() => {});
      }
    })
  );

  return rung;
}

/**
 * Stops every staff device still ringing for a call, optionally sparing the one
 * that just answered.
 *
 * The conditional update is the whole idempotency story. Only legs this call
 * actually moves into CANCELING are cancelled by it, so two settlement paths
 * racing each other — a staff answer and the caller hanging up in the same
 * instant — cannot both issue a REST cancel for the same leg, and a callback
 * Twilio retries cannot either.
 *
 * DECLINED legs are deliberately excluded rather than merely redundant.
 * Cancelling an invite a device has already rejected is what crashes the iOS
 * SDK (twilio-voice-react-native#722): the cancel arrives with no matching
 * invite, and the raise happens inside the PushKit delegate before its
 * completion handler, after which iOS throttles VoIP delivery to the app. The
 * patch in the mobile repo makes that survivable; not asking for it in the
 * first place is what makes it rare.
 */
export async function cancelStaffLegs(
  callId: string,
  opts: { exceptLegId?: string } = {}
): Promise<number> {
  const claimed = await prisma.callLeg.updateMany({
    where: {
      callId,
      status: { in: [...LIVE_LEG_STATUSES] },
      ...(opts.exceptLegId ? { id: { not: opts.exceptLegId } } : {}),
    },
    data: { status: "CANCELING" },
  });
  if (claimed.count === 0) return 0;

  // Legs without a callSid (Twilio never created the call) are already done —
  // nothing to REST-cancel, just mark them terminal.
  await prisma.callLeg.updateMany({
    where: { callId, status: "CANCELING", callSid: null },
    data: { status: "ENDED" },
  });

  const legs = await prisma.callLeg.findMany({
    where: { callId, status: "CANCELING", callSid: { not: null } },
    select: { id: true, callSid: true },
  });
  if (legs.length === 0) return 0;

  const client = twilioClient();
  await Promise.all(
    legs.map(async (leg) => {
      try {
        await client.calls(leg.callSid!).update({ status: "canceled" });
      } catch (error) {
        if (!isAlreadyGone(error)) {
          console.error("[voice] could not cancel staff leg", { legId: leg.id, error });
        }
      } finally {
        await prisma.callLeg
          .update({ where: { id: leg.id }, data: { status: "ENDED" } })
          .catch(() => {});
      }
    })
  );

  return legs.length;
}

/**
 * Claims a call for one staff leg. Resolves true for the leg that may bridge,
 * false for every other — including a second tap on the same device.
 */
export async function claimCallForLeg(callId: string, legId: string): Promise<boolean> {
  const claimed = await prisma.call.updateMany({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    data: { claimedByLegId: legId },
  });
  return claimed.count === 1;
}

/**
 * Sends the caller to voicemail once the last device ringing for them has
 * declined.
 *
 * Declining is per-device on purpose: one mechanic putting their phone down
 * must not send the shop's customer to voicemail while a colleague is reaching
 * for theirs, which is how every multi-handset business line behaves. That only
 * holds while somebody is still being rung — so when the last live leg goes,
 * the caller stops holding for staff who have all said no.
 *
 * Nothing happens if the call was answered or has already ended; the claim and
 * the row's own terminal state are both checked in the update that closes it,
 * so a decline landing just after a colleague picked up is a no-op.
 */
export async function voicemailIfAllDeclined(opts: {
  callId: string;
  baseUrl: string;
}): Promise<boolean> {
  const { callId, baseUrl } = opts;

  const live = await prisma.callLeg.count({
    where: { callId, status: { in: [...LIVE_LEG_STATUSES] } },
  });
  if (live > 0) return false;

  const call = await prisma.call.findFirst({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    select: { id: true, twilioParentCallSid: true },
  });
  if (!call) return false;

  // Claiming the row is what keeps two final declines from both redirecting the
  // caller and restarting a greeting that is already playing.
  const closed = await prisma.call.updateMany({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    data: { status: "NO_ANSWER", endedAt: new Date() },
  });
  if (closed.count === 0) return false;

  await sendQueuedCallerToVoicemail(
    call.twilioParentCallSid,
    `${baseUrl}/api/webhooks/twilio/voice/voicemail`
  ).catch((error) => {
    // They may have hung up in the meantime, or /dequeued may have moved them
    // already. The row is closed either way.
    console.error("[voice] could not send an all-declined caller to voicemail:", error);
  });

  return true;
}
