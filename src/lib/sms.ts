import Twilio from "twilio";
import { getCustomerNotificationBlockReason } from "./env";
import { getCustomerBillUrl, getCustomerStatusUrl } from "./job-customer-access";
import { normalizePhone } from "./phone";

type SmsProvider = "twilio";

interface SmsSendResult {
  ok: boolean;
  error?: string;
  provider?: SmsProvider;
  externalMessageId?: string;
  externalStatus?: string;
  externalStatusName?: string;
  externalStatusDescription?: string;
}

const twilio =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const TWILIO_FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? null;

function isTwilioConfigured(): boolean {
  return Boolean(twilio && TWILIO_FROM_NUMBER);
}

export function getConfiguredSmsProvider(): SmsProvider | null {
  if (isTwilioConfigured()) return "twilio";
  return null;
}

export function getConfiguredSmsSender(): string | null {
  return isTwilioConfigured() ? TWILIO_FROM_NUMBER : null;
}

function getSmsNotConfiguredError(): string {
  return "SMS not configured";
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

    return { ok: true, provider: "twilio", externalMessageId: response.sid };
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
  const blockReason = getCustomerNotificationBlockReason();
  if (blockReason) {
    console.warn(`[sms] Skipping send: ${blockReason}`);
    return { ok: false, error: blockReason };
  }

  if (!isTwilioConfigured()) {
    return { ok: false, error: getSmsNotConfiguredError() };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  return sendTwilioSms(normalized, text);
}

/** SMS templates - slugs match email templates. {{statusUrl}} links to /status/[jobId] */
const SMS_TEMPLATES: Record<string, string> = {
  booking_confirmation_dropoff:
    "{{shopName}}\n\nBooking confirmed! Your {{bikeMake}} {{bikeModel}} is scheduled.\n\nDrop off at the shop.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  booking_confirmation_collection:
    "{{shopName}}\n\nBooking confirmed! We'll collect your {{bikeMake}} {{bikeModel}} as arranged.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_arrived:
    "{{shopName}}\n\nYour {{bikeMake}} {{bikeModel}} has arrived.\n\nTrack status: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_collected:
    "{{shopName}}\n\nWe've collected your {{bikeMake}} {{bikeModel}}.\n\nTrack status: {{statusUrl}}\n\nReply STOP to opt out.",
  working_on_bike:
    "{{shopName}}\n\nWe're working on your {{bikeMake}} {{bikeModel}}.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  waiting_on_parts:
    "{{shopName}}\n\nWaiting on parts for your {{bikeMake}} {{bikeModel}}.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  waiting_on_customer:
    "{{shopName}}\n\nWe need your approval to continue work on your {{bikeMake}} {{bikeModel}}.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_ready:
    "{{shopName}}\n\n{{bikeReadyMessage}}\n\nView your itemized bill: {{billUrl}}\n\nReply STOP to opt out.",
  bike_ready_invoice:
    "{{shopName}}\n\n{{bikeReadyMessage}}\n\nView your itemized bill: {{billUrl}}\n\nReply STOP to opt out.",
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
    WAITING_ON_CUSTOMER: "waiting_on_customer",
    WAITING_ON_PARTS: "waiting_on_parts",
    BIKE_READY: "bike_ready_invoice",
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
  deliveryType?: string;
  customer: { firstName: string; lastName: string | null } | null;
}

function getBikeReadySmsMessage(job: JobForSms): string {
  const bikeName = `${job.bikeMake} ${job.bikeModel}`.trim();
  if (job.deliveryType === "COLLECTION_SERVICE") {
    return `Good news! Your ${bikeName} is ready and raring to roll. We'll be in touch to schedule its return home.`;
  }
  return `Good news! Your ${bikeName} is ready for pickup.`;
}

export async function buildJobSmsMessage(
  templateSlug: string,
  job: JobForSms
): Promise<{ ok: boolean; message?: string; error?: string }> {
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

  const statusUrl = getCustomerStatusUrl(job.id, job.shopId, shopRow?.subdomain);
  const billUrl = getCustomerBillUrl(job.id, job.shopId, shopRow?.subdomain);

  const vars: Record<string, string> = {
    customerName,
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    bikeReadyMessage: getBikeReadySmsMessage(job),
    shopName,
    statusUrl,
    billUrl,
  };

  return { ok: true, message: mergeTemplateVariables(body, vars) };
}

export async function sendJobSms(
  templateSlug: string,
  phoneNumber: string,
  job: JobForSms
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const built = await buildJobSmsMessage(templateSlug, job);
  if (!built.ok || !built.message) {
    return { ok: false, error: built.error };
  }

  const result = await sendSms(phoneNumber, built.message);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  const { prisma } = await import("./db");

  try {
    await prisma.jobSms.create({
      data: {
        shopId: job.shopId,
        jobId: job.id,
        templateSlug,
        recipient: normalized,
      },
    });

    return { ok: true, message: built.message };
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
  opts?: { attachmentOnly?: boolean; shopSubdomain?: string; messageId?: string }
): Promise<SmsSendResult> {
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  let body: string;
  if (opts?.attachmentOnly) {
    body = `${shopName}\n\nWe sent you a photo in chat.\n\nReply to this text to message us.\n\nReply STOP to opt out.`;
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
): Promise<{ ok: boolean; error?: string; externalMessageId?: string }> {
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const body = `${shopName}\n\nSMS test - if you received this, your configured SMS provider is working.`;
  return sendSms(phoneNumber, body);
}

/** Direct SMS send for system replies like STOP/HELP confirmations. */
export async function sendPlainSms(
  phoneNumber: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendSms(phoneNumber, body);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
