import "server-only";

import crypto from "crypto";
import type { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/phone";
import { normalizeIANATimezone } from "@/lib/timezone";
import { getJobQueueInfo } from "@/lib/job-queue-position";
import {
  buildVoiceFirstMessage,
  buildVoiceSystemPrompt,
  type VoiceAgentMode,
  type VoiceCallerJob,
} from "@/lib/ai/voice-prompt";

/**
 * Hands an inbound call to the shop's AI phone assistant.
 *
 * The conversation itself runs on an ElevenLabs agent — speech recognition,
 * the model, the voice, and the turn-taking that makes it sound like a person
 * rather than a phone tree. Vercel functions can't hold the live audio stream
 * a call needs, so Twilio streams it to ElevenLabs directly, and this app only
 * appears at the edges:
 *
 * - /incoming registers the call and returns the TwiML ElevenLabs gives back,
 *   with this shop's prompt and the caller's open repairs folded into it, so
 *   the assistant never has to pause mid-call to look anything up.
 * - The agent's transfer_to_staff tool calls /api/webhooks/elevenlabs/transfer,
 *   which moves the caller into the shop queue and rings staff as usual.
 * - When a conversation ends, /api/webhooks/elevenlabs/post-call files what
 *   was said with the call and tells staff.
 *
 * One agent serves every shop: everything shop-specific is sent per call, and
 * the agent itself only holds the voice, model, and tool definitions. See
 * docs/ai-phone-assistant.md for its setup.
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/**
 * How long /incoming waits for ElevenLabs before ringing staff instead. The
 * caller hears nothing until TwiML comes back, so this is dead air on the line,
 * and a call that falls back late is worse than one that falls back now.
 */
const REGISTER_TIMEOUT_MS = 4_000;

/** How long a call ref stays valid — longer than any real phone call. */
const CALL_REF_TTL_MS = 3 * 60 * 60 * 1000;

/** How much of a webhook timestamp's age is tolerated, matching ElevenLabs' SDK. */
const WEBHOOK_TOLERANCE_MS = 30 * 60 * 1000;

const MAX_SERVICES = 40;
const MAX_CLOSED_DATES = 6;

/** Stages a caller can be told about. Finished and cancelled jobs are history. */
const OPEN_STAGES: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
];

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** Everything the phone assistant needs. Unset means calls ring staff as before. */
export function isVoiceAgentConfigured(): boolean {
  return Boolean(
    env("ELEVENLABS_API_KEY") &&
      env("ELEVENLABS_AGENT_ID") &&
      env("ELEVENLABS_WEBHOOK_SECRET") &&
      env("VOICE_AGENT_TOOL_SECRET")
  );
}

/** Whether this shop's calls are answered by the assistant right now. */
export async function isAiVoiceAnswering(shopId: string): Promise<boolean> {
  if (!isVoiceAgentConfigured()) return false;
  const settings = await prisma.appSettings.findUnique({
    where: { shopId },
    select: { aiVoiceEnabled: true },
  });
  return settings?.aiVoiceEnabled ?? false;
}

// ---------------------------------------------------------------------------
// Call refs
// ---------------------------------------------------------------------------

/**
 * What the agent's tools are told about the call they are acting on.
 *
 * The agent is shared by every shop, so its tools post to one fixed URL and
 * have to say which call they mean. That arrives as a header the agent fills
 * from a dynamic variable — readable by anyone who can see the agent's
 * requests, so it is signed rather than trusted: a tool request can only ever
 * act on a call this app itself handed to the agent, and only at the webhook
 * host Twilio originally called for it.
 */
export type CallRef = {
  callId: string;
  shopId: string;
  /** Scheme + host of the shop's Twilio webhooks, for redirecting the call. */
  base: string;
  mode: VoiceAgentMode;
  exp: number;
};

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function signCallRef(ref: Omit<CallRef, "exp">): string {
  const secret = env("VOICE_AGENT_TOOL_SECRET");
  if (!secret) throw new Error("VOICE_AGENT_TOOL_SECRET is not set");
  const payload = Buffer.from(
    JSON.stringify({ ...ref, exp: Date.now() + CALL_REF_TTL_MS })
  ).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyCallRef(raw: string | null | undefined): CallRef | null {
  const secret = env("VOICE_AGENT_TOOL_SECRET");
  if (!secret || !raw) return null;
  const [payload, signature] = raw.trim().split(".");
  if (!payload || !signature || !safeEqual(signature, hmac(secret, payload))) return null;
  try {
    const ref = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CallRef;
    if (typeof ref.exp !== "number" || ref.exp < Date.now()) return null;
    if (!ref.callId || !ref.shopId || !ref.base) return null;
    if (ref.mode !== "answer" && ref.mode !== "message") return null;
    return ref;
  } catch {
    return null;
  }
}

/** The shared secret the agent's tools send, as a second lock beside the ref. */
export function hasValidToolSecret(header: string | null): boolean {
  const secret = env("VOICE_AGENT_TOOL_SECRET");
  if (!secret || !header) return false;
  return safeEqual(header.replace(/^Bearer\s+/i, "").trim(), secret);
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

/**
 * Verifies ElevenLabs' `ElevenLabs-Signature` header: `t=<unix seconds>,v0=<hex>`,
 * where the hex is HMAC-SHA256 of `<t>.<raw body>` under the webhook secret.
 * Any one matching v0 is enough — the header can carry several during a
 * secret rotation.
 */
export function verifyElevenLabsSignature(rawBody: string, header: string | null): boolean {
  const secret = env("ELEVENLABS_WEBHOOK_SECRET");
  if (!secret || !header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
    if (key === "t") timestamp = value ?? null;
    if (key === "v0" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Date.now() - seconds * 1000) > WEBHOOK_TOLERANCE_MS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return signatures.some((signature) => safeEqual(signature, expected));
}

// ---------------------------------------------------------------------------
// The per-call prompt
// ---------------------------------------------------------------------------

function formatPrice(value: { toString(): string }): string {
  const amount = Number(value.toString());
  if (!Number.isFinite(amount)) return "";
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function describeStage(job: {
  stage: Stage;
  deliveryType: string;
  dropOffDate: Date | null;
}, timeZone: string): string {
  switch (job.stage) {
    case "PENDING_APPROVAL":
      return "Booking request received; the shop hasn't confirmed it yet.";
    case "BOOKED_IN": {
      const due = job.dropOffDate
        ? ` for ${job.dropOffDate.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" })}`
        : "";
      return job.deliveryType === "COLLECTION_SERVICE"
        ? `Booked in for the shop to pick up${due}; it hasn't been collected yet.`
        : `Booked in${due}, but the bike hasn't been dropped off yet.`;
    }
    case "RECEIVED":
      return "At the shop, waiting its turn in the workshop.";
    case "WORKING_ON":
      return "Being worked on right now.";
    case "WAITING_ON_CUSTOMER":
      return "On hold until the shop hears back from the customer — someone there needs a reply or a decision from them.";
    case "WAITING_ON_PARTS":
      return "Waiting on parts to arrive.";
    case "BIKE_READY":
      return "Finished and ready to be picked up.";
    default:
      return "In the shop.";
  }
}

async function loadCallerJobs(
  shopId: string,
  customerId: string,
  timeZone: string
): Promise<VoiceCallerJob[]> {
  const jobs = await prisma.job.findMany({
    where: { shopId, customerId, archivedAt: null, stage: { in: OPEN_STAGES } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      stage: true,
      deliveryType: true,
      dropOffDate: true,
      receivedAt: true,
      createdAt: true,
      bikeMake: true,
      bikeModel: true,
      jobBikes: {
        orderBy: { sortOrder: "asc" },
        select: { make: true, model: true, year: true, nickname: true },
      },
    },
  });

  return Promise.all(
    jobs.map(async (job) => {
      const bikes = job.jobBikes.length
        ? job.jobBikes.map(
            (bike) =>
              [bike.year, bike.make, bike.model].filter(Boolean).join(" ") ||
              bike.nickname ||
              "a bike"
          )
        : [[job.bikeMake, job.bikeModel].filter(Boolean).join(" ")].filter(Boolean);
      const queue = await getJobQueueInfo(prisma, shopId, job).catch(() => null);
      return {
        bikes,
        status: describeStage(job, timeZone),
        queue: queue?.label ?? null,
        receivedOn: job.receivedAt
          ? job.receivedAt.toLocaleDateString("en-US", {
              timeZone,
              weekday: "long",
              month: "long",
              day: "numeric",
            })
          : null,
      };
    })
  );
}

async function buildVoiceAgentContext({
  shopId,
  customerId,
  base,
  mode,
}: {
  shopId: string;
  customerId: string | null;
  base: string;
  mode: VoiceAgentMode;
}) {
  const [shop, settings, services, customer] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { name: true, address: true },
    }),
    prisma.appSettings.findUnique({
      where: { shopId },
      select: {
        aiVoiceName: true,
        aiAssistantKnowledge: true,
        bookingsEnabled: true,
        closedDates: true,
        collectionServiceEnabled: true,
        collectionRadiusMiles: true,
        collectionFeeRegular: true,
        collectionFeeEbike: true,
        shopPhone: true,
        timezone: true,
        voiceEnabled: true,
      },
    }),
    prisma.service.findMany({
      where: { shopId, isHidden: false, isSystem: false },
      orderBy: { name: "asc" },
      take: MAX_SERVICES,
      select: { name: true, price: true, description: true },
    }),
    customerId
      ? prisma.customer.findFirst({
          where: { id: customerId, shopId },
          select: { firstName: true, provisional: true },
        })
      : null,
  ]);

  const timeZone = normalizeIANATimezone(settings?.timezone);
  const shopName = shop?.name ?? "the shop";
  // A provisional contact's first name is the phone number standing in for
  // one, which is not something to greet a caller with.
  const callerFirstName =
    customer && !customer.provisional ? customer.firstName.trim() || null : null;
  const callerJobs = customerId ? await loadCallerJobs(shopId, customerId, timeZone) : [];

  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  const closedDates = (Array.isArray(settings?.closedDates) ? settings.closedDates : [])
    .filter(
      (entry): entry is { date: string; reason?: string } =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as { date?: unknown }).date === "string" &&
        (entry as { date: string }).date >= today
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_CLOSED_DATES)
    .map((entry) => {
      // Noon UTC keeps the calendar date the same in every US timezone.
      const label = new Date(`${entry.date}T12:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      return entry.reason ? `${label} (${entry.reason})` : label;
    });

  const assistantName = settings?.aiVoiceName?.trim() || null;
  const prompt = buildVoiceSystemPrompt({
    mode,
    shopName,
    assistantName,
    address: shop?.address?.trim() || null,
    shopPhone: settings?.shopPhone ? formatPhoneDisplay(settings.shopPhone) : null,
    localTime: new Date().toLocaleString("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    knowledge: settings?.aiAssistantKnowledge ?? null,
    services: services.map((service) => ({
      name: service.name,
      price: formatPrice(service.price),
      description: service.description?.trim() || null,
    })),
    bookingsOpen: settings?.bookingsEnabled ?? true,
    closedDates,
    collection: {
      enabled: settings?.collectionServiceEnabled ?? false,
      radiusMiles: settings?.collectionRadiusMiles ?? 0,
      feeRegular: formatPrice(settings?.collectionFeeRegular ?? 0),
      feeEbike: formatPrice(settings?.collectionFeeEbike ?? 0),
    },
    bookingUrl: base ? `${base.replace(/^https?:\/\//, "")}/book` : null,
    callerFirstName,
    callerJobs,
    // Voice calls off means no staff device is registered to ring, so a
    // transfer would only hold the caller in silence until it gave up.
    canTransfer: settings?.voiceEnabled ?? false,
  });

  return {
    prompt,
    firstMessage: buildVoiceFirstMessage({ mode, shopName, assistantName, callerFirstName }),
    shopName,
    callerFirstName,
  };
}

// ---------------------------------------------------------------------------
// Registering a call
// ---------------------------------------------------------------------------

/** Pulls the TwiML document out of register-call's response, whatever it's wrapped in. */
function extractTwiml(body: string): string | null {
  let text = body.trim();
  if (text.startsWith('"')) {
    try {
      text = JSON.parse(text) as string;
    } catch {
      return null;
    }
  } else if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const candidate = parsed.twiml ?? parsed.TwiML ?? parsed.response;
      text = typeof candidate === "string" ? candidate : "";
    } catch {
      return null;
    }
  }
  return text.includes("<Response") ? text : null;
}

/**
 * Registers a live Twilio call with the agent and returns the TwiML that
 * connects its audio. Null on any failure — the caller is never left on a
 * dead line because ElevenLabs was slow or down; the route rings staff or
 * takes a voicemail instead.
 */
export async function connectCallToVoiceAgent({
  shopId,
  callId,
  customerId,
  base,
  fromNumber,
  toNumber,
  mode,
}: {
  shopId: string;
  callId: string;
  customerId: string | null;
  base: string;
  fromNumber: string;
  toNumber: string;
  mode: VoiceAgentMode;
}): Promise<string | null> {
  const apiKey = env("ELEVENLABS_API_KEY");
  const agentId = env("ELEVENLABS_AGENT_ID");
  if (!apiKey || !agentId || !isVoiceAgentConfigured()) return null;

  try {
    const context = await buildVoiceAgentContext({ shopId, customerId, base, mode });
    const response = await fetch(`${ELEVENLABS_API_BASE}/v1/convai/twilio/register-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      body: JSON.stringify({
        agent_id: agentId,
        from_number: fromNumber,
        to_number: toNumber,
        direction: "inbound",
        conversation_initiation_client_data: {
          dynamic_variables: {
            bikeops_call_ref: signCallRef({ callId, shopId, base, mode }),
            bikeops_mode: mode,
            shop_name: context.shopName,
            caller_name: context.callerFirstName ?? "",
          },
          conversation_config_override: {
            agent: {
              first_message: context.firstMessage,
              prompt: { prompt: context.prompt },
            },
          },
        },
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      console.error("[voice-agent] register-call failed:", response.status, body.slice(0, 500));
      return null;
    }
    const twiml = extractTwiml(body);
    if (!twiml) {
      console.error("[voice-agent] register-call returned no TwiML:", body.slice(0, 500));
    }
    return twiml;
  } catch (error) {
    console.error("[voice-agent] could not connect call to the agent:", {
      shopId,
      callId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
