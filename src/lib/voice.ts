import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import Twilio from "twilio";
import { prisma } from "@/lib/db";
import { getTwilioInboundWebhookUrl, validateTwilioWebhook } from "@/lib/chat-sms";
import { getShopForHost, type CurrentShop } from "@/lib/shop";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  INCOMING_CALL_CHANNEL_ID,
  INCOMING_CALL_SOUND,
  sendPushToAllStaff,
} from "@/lib/push";
// Also re-exported at the foot of this file; imported here because the ring
// push has to tell the app when the window closes.
import { ringDeadline } from "@/lib/voice-twiml";

export type VoicePlatform = "ios" | "android";

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? null;
const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? null;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? null;
const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim() ?? null;
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? null;
const iosPushCredentialSid = process.env.TWILIO_IOS_PUSH_CREDENTIAL_SID?.trim() ?? null;
const androidPushCredentialSid =
  process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID?.trim() ?? null;

export const TWILIO_VOICE_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? null;

/**
 * Voicemail transcription bills per minute on Twilio's side, so it gets an
 * explicit kill switch. Defaults to on — set VOICEMAIL_TRANSCRIPTION_ENABLED
 * to "false" to stop requesting transcripts without touching any code.
 */
export function isVoicemailTranscriptionEnabled(): boolean {
  return process.env.VOICEMAIL_TRANSCRIPTION_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * How long a call is left on "in-progress" before its transcript is written
 * off, measured from `endedAt`.
 *
 * Deliberately roomier than the missed-call sweep's grace, because `endedAt`
 * is stamped when the *greeting* starts rather than when the caller hangs up.
 * A caller using the full <Record maxLength> is still talking two minutes
 * past it, and transcription only begins once that audio is processed — so
 * the budget here is two minutes of recording plus eight of Twilio's own
 * turnaround. Guessing short would flash "Transcript unavailable" on a
 * voicemail that was about to arrive.
 */
const TRANSCRIPTION_STALL_MS = 10 * 60 * 1000;

/**
 * Clears the "Transcribing…" state off calls that will never get a transcript.
 *
 * /voicemail marks the row in-progress the moment the greeting starts, so the
 * app can say "Transcribing…" instead of showing an empty gap. That bet only
 * pays off if a transcribeCallback actually follows, and for a caller who hung
 * up during the greeting one never does: Twilio writes no recording for
 * zero-length audio, so it has nothing to transcribe and sends nothing. The
 * row sat on "Transcribing…" forever.
 *
 * The two stalls are not the same thing, and they don't resolve the same way:
 *
 * - A row with a recording did get a voicemail, and the transcript is what
 *   went missing. "failed" is the status Twilio itself would have sent, and
 *   the app already reads it as "Transcript unavailable" beside working
 *   playback.
 * - A row with no recording never had a voicemail to transcribe. Null means
 *   "never requested", which is the truth here, and leaves the app showing
 *   nothing rather than a transcript error for a message that doesn't exist.
 */
export async function resolveStalledTranscriptions(): Promise<{
  unavailable: number;
  cleared: number;
}> {
  const cutoff = new Date(Date.now() - TRANSCRIPTION_STALL_MS);
  const stalled = {
    transcriptionStatus: "in-progress",
    transcriptionText: null,
    endedAt: { not: null, lt: cutoff },
  } as const;

  const [unavailable, cleared] = await Promise.all([
    prisma.call.updateMany({
      where: { ...stalled, recordingUrl: { not: null } },
      data: { transcriptionStatus: "failed" },
    }),
    prisma.call.updateMany({
      where: { ...stalled, recordingUrl: null },
      data: { transcriptionStatus: null },
    }),
  ]);

  return { unavailable: unavailable.count, cleared: cleared.count };
}

/**
 * Optional audio played to callers waiting in the queue. Unset means the
 * spoken hold in buildQueueWaitTwiml, which needs no hosted asset; point
 * VOICE_HOLD_MUSIC_URL at an mp3/wav to play real ringback instead.
 */
export function getHoldMusicUrl(): string | null {
  return process.env.VOICE_HOLD_MUSIC_URL?.trim() || null;
}

export function isVoiceConfigured(): boolean {
  return Boolean(accountSid && apiKeySid && apiKeySecret && twimlAppSid && TWILIO_VOICE_NUMBER);
}

const STAFF_IDENTITY_RE = /^shop_(.+)_staff_(.+)$/;

/**
 * Deterministic Twilio Client identity for a staff user. Not a global
 * "staff" string so /incoming can ring every registered staff device for a
 * shop today (one, in practice) without an identity-model change once a
 * second staff device exists.
 */
export function buildStaffIdentity(shopId: string, userId: string): string {
  return `shop_${shopId}_staff_${userId}`;
}

export function parseStaffIdentity(
  identity: string
): { shopId: string; userId: string } | null {
  const match = STAFF_IDENTITY_RE.exec(identity);
  if (!match) return null;
  return { shopId: match[1], userId: match[2] };
}

/** All staff Client identities for a shop, for ringing every device on /incoming. */
export async function getStaffIdentitiesForShop(shopId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { shopId }, select: { id: true } });
  return users.map((u) => buildStaffIdentity(shopId, u.id));
}

/** Mint a Voice Access Token for a staff Client, platform-aware for push (incoming calls). */
export function mintVoiceAccessToken(identity: string, platform: VoicePlatform): string {
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error("Twilio Voice is not configured");
  }

  // Retained only so a device *could* register for Twilio push. Nothing does
  // today: inbound calls ring via an ordinary notification and are answered by
  // dialing into the shop queue, precisely so iOS never forces the call onto
  // the CallKit screen. Its absence is therefore not worth warning about.
  const pushCredentialSid =
    platform === "ios" ? iosPushCredentialSid : androidPushCredentialSid;

  const AccessToken = Twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });
  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
      ...(pushCredentialSid ? { pushCredentialSid } : {}),
    })
  );
  return token.toJwt();
}

/**
 * Rings every staff device for a call that is still waiting to be answered.
 *
 * This push *is* the ring — there is no PushKit here — and one alert is not a
 * ring, so it is sent repeatedly for as long as the caller holds. /incoming
 * fires the first, and /wait fires another on each pass, which Twilio requests
 * roughly every six seconds while the caller is in the queue. That cadence is
 * also what makes it stop by itself: a caller who has been answered, declined
 * or timed out is no longer in the queue, so the waitUrl is never requested
 * again and there is no timer to cancel.
 *
 * Resolves false without sending when the call is no longer ringing, which
 * covers the race where one last /wait lands just after someone picks up.
 *
 * Each send is a separate notification, so a call left to ring out leaves a
 * short stack of them behind; the app clears them once the call is no longer
 * ringing.
 */
export async function ringStaffForCall(shopId: string, callSid: string): Promise<boolean> {
  const call = await prisma.call.findUnique({
    where: { shopId_twilioParentCallSid: { shopId, twilioParentCallSid: callSid } },
    select: {
      id: true,
      status: true,
      fromNumber: true,
      startedAt: true,
      createdAt: true,
      customerId: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!call || call.status !== "RINGING") return false;

  const name = call.customer
    ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
    : "";
  const callerLabel = name || formatPhoneDisplay(call.fromNumber);

  // When this caller runs out of hold and falls through to voicemail. Sent
  // with every repeat of the ring so the app can retire its answer buttons on
  // the caller's clock rather than its own: the ring repeats, and a device
  // waking up on the fourth alert has no other way to know how much of the
  // window is already gone.
  const ringEndsAt = ringDeadline(call.startedAt ?? call.createdAt).toISOString();

  await sendPushToAllStaff(shopId, {
    title: "Incoming call",
    body: callerLabel,
    // Everything that makes this sound like a phone ringing rather than
    // another notification: its own tone, its own Android channel, and
    // priorities that keep a dozing phone or a Focus mode from sitting on it
    // until the caller has already been sent to voicemail.
    sound: INCOMING_CALL_SOUND,
    channelId: INCOMING_CALL_CHANNEL_ID,
    priority: "high",
    interruptionLevel: "time-sensitive",
    // The ring repeats every few seconds for as long as the caller holds, and
    // each repeat used to land as its own alert — one call left a stack of
    // identical "Incoming call" rows to clear by hand. Keyed by call id, every
    // repeat replaces the previous one, so a ringing call is a single
    // notification that keeps refreshing itself. Per call rather than per
    // shop: a second caller holding behind the first is ringing too, and
    // their alert must not replace the one being answered.
    collapseKey: `incoming-call:${call.id}`,
    data: {
      type: "incoming_call",
      callId: call.id,
      callSid,
      from: call.fromNumber,
      customerId: call.customerId,
      customerName: name || null,
      ringEndsAt,
    },
  });
  return true;
}

/**
 * Sends a caller who is holding in the queue straight to voicemail. Used by
 * the decline button: without it a declined caller keeps hearing hold audio
 * until the ring window expires on its own.
 *
 * Redirecting pops the call out of the queue, so the <Enqueue> action fires
 * with QueueResult=redirected — which /dequeued also routes to voicemail, so
 * the two paths converge on the same place whichever lands first.
 */
export async function sendQueuedCallerToVoicemail(
  callSid: string,
  voicemailUrl: string
): Promise<void> {
  if (!accountSid || !authToken) {
    throw new Error("Twilio is not configured");
  }
  await Twilio(accountSid, authToken)
    .calls(callSid)
    .update({ url: voicemailUrl, method: "POST" });
}

/** Scheme + host only, for building sibling webhook URLs to embed in TwiML. */
export function getVoiceWebhookBaseUrl(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export type VoiceWebhookContext = {
  shop: CurrentShop;
  params: Record<string, string>;
};

/**
 * Shared preamble for all /api/webhooks/twilio/voice/* routes: validates the
 * Twilio signature and resolves the tenant shop from the request host,
 * exactly like the SMS webhook. Returns a ready-to-return NextResponse on
 * any failure so callers can `if (ctx instanceof NextResponse) return ctx;`.
 */
export async function authenticateVoiceWebhook(
  request: NextRequest
): Promise<VoiceWebhookContext | NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    return new NextResponse("Configuration error", { status: 500 });
  }

  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  const signature = request.headers.get("X-Twilio-Signature");
  // Twilio signs the full URL, query string included, and
  // getTwilioInboundWebhookUrl builds from the pathname alone. Every voice
  // route that existed before staff legs was query-free, so appending this
  // changes nothing for them — but /staff-answer and /staff-leg carry the leg
  // id there, and would fail validation on every request without it.
  const url = `${getTwilioInboundWebhookUrl(request)}${request.nextUrl.search}`;
  if (!validateTwilioWebhook(authToken, signature, url, params)) {
    console.warn("Twilio Voice webhook: invalid signature", request.nextUrl.pathname);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop) {
    console.warn("Twilio Voice webhook: shop not found for host", hostHeader);
    return new NextResponse("Not found", { status: 404 });
  }

  return { shop, params };
}

/** Map Twilio's raw CallStatus string to our CallStatus enum. */
export function mapTwilioCallStatus(
  raw: string | undefined
): "QUEUED" | "RINGING" | "IN_PROGRESS" | "COMPLETED" | "BUSY" | "FAILED" | "NO_ANSWER" | "CANCELED" | null {
  switch (raw) {
    case "queued":
      return "QUEUED";
    case "ringing":
      return "RINGING";
    case "in-progress":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    case "busy":
      return "BUSY";
    case "failed":
      return "FAILED";
    case "no-answer":
      return "NO_ANSWER";
    case "canceled":
      return "CANCELED";
    default:
      return null;
  }
}

export {
  RING_SECONDS,
  ringDeadline,
  hasRungOut,
  ringWindowCutoff,
  buildQueueName,
  buildIncomingCallTwiml,
  buildQueueWaitTwiml,
  buildDequeuedTwiml,
  buildDequeueTwiml,
  buildOutgoingCallTwiml,
  buildVoicemailTwiml,
} from "@/lib/voice-twiml";
