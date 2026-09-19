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
      customerId: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!call || call.status !== "RINGING") return false;

  const name = call.customer
    ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
    : "";
  const callerLabel = name || formatPhoneDisplay(call.fromNumber);

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
    data: {
      type: "incoming_call",
      callId: call.id,
      callSid,
      from: call.fromNumber,
      customerId: call.customerId,
      customerName: name || null,
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
  const url = getTwilioInboundWebhookUrl(request);
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
  buildQueueName,
  buildIncomingCallTwiml,
  buildQueueWaitTwiml,
  buildDequeuedTwiml,
  buildDequeueTwiml,
  buildOutgoingCallTwiml,
  buildVoicemailTwiml,
} from "@/lib/voice-twiml";
