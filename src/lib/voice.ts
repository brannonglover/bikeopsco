import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import Twilio from "twilio";
import { prisma } from "@/lib/db";
import { getTwilioInboundWebhookUrl, validateTwilioWebhook } from "@/lib/chat-sms";
import { getShopForHost, type CurrentShop } from "@/lib/shop";

export type VoicePlatform = "ios" | "android";

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? null;
const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? null;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? null;
const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim() ?? null;
const iosPushCredentialSid = process.env.TWILIO_IOS_PUSH_CREDENTIAL_SID?.trim() ?? null;
const androidPushCredentialSid =
  process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID?.trim() ?? null;

export const TWILIO_VOICE_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? null;

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

  const pushCredentialSid =
    platform === "ios" ? iosPushCredentialSid : androidPushCredentialSid;
  if (!pushCredentialSid) {
    console.warn(
      `[voice] No push credential configured for platform "${platform}" — incoming calls won't ring while backgrounded/terminated.`
    );
  }

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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/**
 * TwiML for /incoming: ring every staff identity for the shop simultaneously
 * (first to answer wins) with an action fallback to /voicemail on no-answer.
 * Also sets statusCallback on the <Dial> so the child leg's answered/
 * completed/no-answer events reach /status (see call-leg correlation notes).
 */
export function buildIncomingCallTwiml(opts: {
  identities: string[];
  statusCallbackUrl: string;
  voicemailActionUrl: string;
  ringSeconds?: number;
}): string {
  const { identities, statusCallbackUrl, voicemailActionUrl, ringSeconds = 20 } = opts;

  if (identities.length === 0) {
    return twiml(`<Redirect method="POST">${escapeXml(voicemailActionUrl)}</Redirect>`);
  }

  const clients = identities.map((id) => `<Client>${escapeXml(id)}</Client>`).join("");
  return twiml(
    `<Dial timeout="${ringSeconds}" action="${escapeXml(voicemailActionUrl)}" method="POST" ` +
      `statusCallback="${escapeXml(statusCallbackUrl)}" ` +
      `statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">` +
      `${clients}</Dial>`
  );
}

/**
 * TwiML for /outgoing: the TwiML App's Voice Request URL, hit when the
 * mobile Voice SDK places an outbound call. Dials the PSTN leg to the
 * customer, showing the shop's Twilio number as caller ID.
 *
 * ringTone is pinned to "us" so the caller hears a familiar US ringback
 * while the customer's phone rings. Without it Twilio picks its own default,
 * which sounds foreign enough that staff mistake it for a failed call.
 */
export function buildOutgoingCallTwiml(opts: {
  toNumber: string;
  callerId: string;
  statusCallbackUrl: string;
}): string {
  const { toNumber, callerId, statusCallbackUrl } = opts;
  return twiml(
    `<Dial callerId="${escapeXml(callerId)}" ringTone="us" ` +
      `statusCallback="${escapeXml(statusCallbackUrl)}" ` +
      `statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">` +
      `<Number>${escapeXml(toNumber)}</Number></Dial>`
  );
}

/**
 * TwiML for /voicemail: greets and records. Deliberately does not persist
 * the recording itself — that arrives asynchronously via /recording once
 * Twilio finishes processing it.
 */
export function buildVoicemailTwiml(opts: {
  recordingStatusCallbackUrl: string;
  greeting?: string;
}): string {
  const {
    recordingStatusCallbackUrl,
    greeting = "Sorry we missed you. Please leave a message after the tone.",
  } = opts;
  return twiml(
    `<Say>${escapeXml(greeting)}</Say>` +
      `<Record maxLength="120" playBeep="true" ` +
      `recordingStatusCallback="${escapeXml(recordingStatusCallbackUrl)}" ` +
      `recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST" />`
  );
}
