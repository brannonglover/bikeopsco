import Twilio from "twilio";
import { getCustomerStatusUrl } from "./env";
import { normalizePhone } from "./phone";

type SmsProvider = "infobip" | "twilio";

interface SmsSendResult {
  ok: boolean;
  error?: string;
  externalMessageId?: string;
}

const twilio =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const TWILIO_FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? null;
const INFOBIP_BASE_URL =
  process.env.INFOBIP_BASE_URL?.trim().replace(/\/+$/, "") ?? null;
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY?.trim() ?? null;
const INFOBIP_SENDER = process.env.INFOBIP_SENDER?.trim() ?? null;

function isInfobipConfigured(): boolean {
  return Boolean(INFOBIP_BASE_URL && INFOBIP_API_KEY && INFOBIP_SENDER);
}

function isTwilioConfigured(): boolean {
  return Boolean(twilio && TWILIO_FROM_NUMBER);
}

export function getConfiguredSmsProvider(): SmsProvider | null {
  if (isInfobipConfigured()) return "infobip";
  if (isTwilioConfigured()) return "twilio";
  return null;
}

export function getConfiguredSmsSender(): string | null {
  const provider = getConfiguredSmsProvider();
  if (provider === "infobip") return INFOBIP_SENDER;
  if (provider === "twilio") return TWILIO_FROM_NUMBER;
  return null;
}

function getSmsNotConfiguredError(): string {
  return "SMS not configured";
}

function formatInfobipAddress(value: string): string {
  const normalized = normalizePhone(value);
  if (normalized) {
    return normalized.replace(/^\+/, "");
  }
  return value.trim();
}

function getInfobipErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const requestError =
    record.requestError && typeof record.requestError === "object"
      ? (record.requestError as Record<string, unknown>)
      : null;
  const serviceException =
    requestError?.serviceException &&
    typeof requestError.serviceException === "object"
      ? (requestError.serviceException as Record<string, unknown>)
      : null;
  const clientException =
    requestError?.clientException &&
    typeof requestError.clientException === "object"
      ? (requestError.clientException as Record<string, unknown>)
      : null;

  const candidates = [
    serviceException?.text,
    clientException?.text,
    record.message,
    record.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function sendInfobipSms(
  to: string,
  text: string
): Promise<SmsSendResult> {
  if (!INFOBIP_BASE_URL || !INFOBIP_API_KEY || !INFOBIP_SENDER) {
    console.warn(
      "Infobip not configured (INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER required), skipping SMS"
    );
    return { ok: false, error: getSmsNotConfiguredError() };
  }

  try {
    const response = await fetch(`${INFOBIP_BASE_URL}/sms/3/messages`, {
      method: "POST",
      headers: {
        Authorization: `App ${INFOBIP_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            sender: formatInfobipAddress(INFOBIP_SENDER),
            destinations: [{ to: formatInfobipAddress(to) }],
            content: { text },
          },
        ],
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          messages?: Array<{ messageId?: string }>;
          requestError?: unknown;
          message?: string;
          error?: string;
        }
      | null;

    if (!response.ok) {
      const error =
        getInfobipErrorMessage(payload) ??
        `Infobip request failed with ${response.status}`;
      console.error("Infobip SMS send error:", error);
      return { ok: false, error };
    }

    return {
      ok: true,
      externalMessageId: payload?.messages?.[0]?.messageId,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("Infobip SMS send error:", err);
    return { ok: false, error: err };
  }
}

async function sendTwilioSms(
  to: string,
  text: string
): Promise<SmsSendResult> {
  if (!twilio || !TWILIO_FROM_NUMBER) {
    console.warn(
      "Twilio not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER required), skipping SMS"
    );
    return { ok: false, error: getSmsNotConfiguredError() };
  }

  try {
    const response = await twilio.messages.create({
      body: text,
      from: TWILIO_FROM_NUMBER,
      to,
    });

    return { ok: true, externalMessageId: response.sid };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("Twilio SMS send error:", err);
    return { ok: false, error: err };
  }
}

async function sendSms(
  phoneNumber: string,
  text: string
): Promise<SmsSendResult> {
  const provider = getConfiguredSmsProvider();
  if (!provider) {
    return { ok: false, error: getSmsNotConfiguredError() };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  if (provider === "infobip") {
    return sendInfobipSms(normalized, text);
  }

  return sendTwilioSms(normalized, text);
}

/** SMS templates - slugs match email templates. {{statusUrl}} links to /status/[jobId] */
const SMS_TEMPLATES: Record<string, string> = {
  booking_confirmation_dropoff:
    "{{shopName}}: Booking confirmed! Your {{bikeMake}} {{bikeModel}} is scheduled. Drop off at the shop. Track: {{statusUrl}} Reply STOP to opt out.",
  booking_confirmation_collection:
    "{{shopName}}: Booking confirmed! We'll collect your {{bikeMake}} {{bikeModel}} as arranged. Track: {{statusUrl}} Reply STOP to opt out.",
  bike_arrived:
    "{{shopName}}: Your {{bikeMake}} {{bikeModel}} has arrived. Track status: {{statusUrl}} Reply STOP to opt out.",
  bike_collected:
    "{{shopName}}: We've collected your {{bikeMake}} {{bikeModel}}. Track status: {{statusUrl}} Reply STOP to opt out.",
  working_on_bike:
    "{{shopName}}: We're working on your {{bikeMake}} {{bikeModel}}. Track: {{statusUrl}} Reply STOP to opt out.",
  waiting_on_parts:
    "{{shopName}}: Waiting on parts for your {{bikeMake}} {{bikeModel}}. Track: {{statusUrl}} Reply STOP to opt out.",
  bike_ready:
    "{{shopName}}: Good news! Your {{bikeMake}} {{bikeModel}} is ready for pickup. {{statusUrl}} Reply STOP to opt out.",
};

export function getTemplateSlugForStage(
  stage: string,
  deliveryType: string
): string | null {
  if (stage === "BOOKED_IN") {
    return deliveryType === "COLLECTION_SERVICE"
      ? "booking_confirmation_collection"
      : "booking_confirmation_dropoff";
  }
  if (stage === "RECEIVED") {
    return deliveryType === "COLLECTION_SERVICE" ? "bike_collected" : "bike_arrived";
  }
  const map: Record<string, string> = {
    WORKING_ON: "working_on_bike",
    WAITING_ON_PARTS: "waiting_on_parts",
    BIKE_READY: "bike_ready",
  };
  return map[stage] ?? null;
}

function mergeTemplateVariables(
  text: string,
  vars: Record<string, string>
): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value ?? ""
    );
  }
  return result;
}

export interface JobForSms {
  id: string;
  shopId: string;
  bikeMake: string;
  bikeModel: string;
  customer: { firstName: string; lastName: string | null } | null;
}

export async function sendJobSms(
  templateSlug: string,
  phoneNumber: string,
  job: JobForSms
): Promise<{ ok: boolean; error?: string }> {
  const body = SMS_TEMPLATES[templateSlug];
  if (!body) {
    return { ok: false, error: `SMS template not found: ${templateSlug}` };
  }

  const { prisma } = await import("./db");
  const shopRow = await prisma.shop
    .findUnique({ where: { id: job.shopId }, select: { name: true, subdomain: true } })
    .catch(() => null);
  const shopName = shopRow?.name ?? process.env.SHOP_NAME ?? "Basement Bike Mechanic";
  const customerName = job.customer
    ? job.customer.lastName
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : job.customer.firstName
    : "Customer";

  const statusUrl = getCustomerStatusUrl(job.id, shopRow?.subdomain);

  const vars: Record<string, string> = {
    customerName,
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    shopName,
    statusUrl,
  };

  const messageBody = mergeTemplateVariables(body, vars);

  const result = await sendSms(phoneNumber, messageBody);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  try {
    await prisma.jobSms.create({
      data: {
        shopId: job.shopId,
        jobId: job.id,
        templateSlug,
        recipient: normalized,
      },
    });

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("SMS persistence error:", err);
    return { ok: false, error: err };
  }
}

const CHAT_SMS_MAX_LEN = 1500;

/** Staff chat → customer phone. Plain text + shop footer; truncates if needed. */
export async function sendChatStaffSms(
  phoneNumber: string,
  messageText: string,
  opts?: { attachmentOnly?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  let body: string;
  if (opts?.attachmentOnly) {
    body = `${shopName}: We sent you a photo in chat. Reply to this text to message us. Reply STOP to opt out.`;
  } else {
    const trimmed = messageText.trim();
    if (!trimmed) {
      return { ok: false, error: "Empty message" };
    }
    body = `${trimmed}\n\n— ${shopName}\nReply to this text to continue. Reply STOP to opt out.`;
  }
  if (body.length > CHAT_SMS_MAX_LEN) {
    body = body.slice(0, CHAT_SMS_MAX_LEN - 3) + "...";
  }
  const result = await sendSms(phoneNumber, body);
  if (!result.ok) {
    console.error("Chat SMS send error:", result.error);
  }
  return result;
}

/** One-off test send (no JobSms row). Uses the configured SMS provider sender. */
export async function sendSmsTest(
  phoneNumber: string
): Promise<{ ok: boolean; error?: string }> {
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const body = `${shopName}: SMS test — if you received this, your configured SMS provider is working.`;
  return sendSms(phoneNumber, body);
}

/** Provider-agnostic direct SMS send for system replies like STOP/HELP confirmations. */
export async function sendPlainSms(
  phoneNumber: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendSms(phoneNumber, body);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
