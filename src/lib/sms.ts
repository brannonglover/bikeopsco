import Twilio from "twilio";
import { getAppUrl } from "./env";
import { normalizePhone } from "./phone";

const twilio =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? null;

/** SMS templates - slugs match email templates. {{statusUrl}} links to /status/[jobId] */
const SMS_TEMPLATES: Record<string, string> = {
  booking_confirmation_dropoff:
    "{{shopName}}: Booking confirmed! Your {{bikeMake}} {{bikeModel}} is scheduled. Drop off at the shop. Track: {{statusUrl}}",
  booking_confirmation_collection:
    "{{shopName}}: Booking confirmed! We'll collect your {{bikeMake}} {{bikeModel}} as arranged. Track: {{statusUrl}}",
  bike_arrived:
    "{{shopName}}: Your {{bikeMake}} {{bikeModel}} has arrived. Track status: {{statusUrl}}",
  bike_collected:
    "{{shopName}}: We've collected your {{bikeMake}} {{bikeModel}}. Track status: {{statusUrl}}",
  working_on_bike:
    "{{shopName}}: We're working on your {{bikeMake}} {{bikeModel}}. Track: {{statusUrl}}",
  waiting_on_parts:
    "{{shopName}}: Waiting on parts for your {{bikeMake}} {{bikeModel}}. Track: {{statusUrl}}",
  bike_ready:
    "{{shopName}}: Good news! Your {{bikeMake}} {{bikeModel}} is ready for pickup. {{statusUrl}}",
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
  bikeMake: string;
  bikeModel: string;
  customer: { firstName: string; lastName: string | null } | null;
}

export async function sendJobSms(
  templateSlug: string,
  phoneNumber: string,
  job: JobForSms
): Promise<{ ok: boolean; error?: string }> {
  if (!twilio || !FROM_NUMBER) {
    console.warn("Twilio not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER required), skipping SMS");
    return { ok: false, error: "SMS not configured" };
  }

  const body = SMS_TEMPLATES[templateSlug];
  if (!body) {
    return { ok: false, error: `SMS template not found: ${templateSlug}` };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }

  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const customerName = job.customer
    ? job.customer.lastName
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : job.customer.firstName
    : "Customer";

  const baseUrl = getAppUrl();
  const statusUrl = baseUrl ? `${baseUrl}/status/${job.id}` : "";

  const vars: Record<string, string> = {
    customerName,
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    shopName,
    statusUrl,
  };

  const messageBody = mergeTemplateVariables(body, vars);

  try {
    await twilio.messages.create({
      body: messageBody,
      from: FROM_NUMBER,
      to: normalized,
    });

    const { prisma } = await import("./db");
    await prisma.jobSms.create({
      data: {
        jobId: job.id,
        templateSlug,
        recipient: normalized,
      },
    });

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("SMS send error:", err);
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
  if (!twilio || !FROM_NUMBER) {
    return { ok: false, error: "SMS not configured" };
  }
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  let body: string;
  if (opts?.attachmentOnly) {
    body = `${shopName}: We sent you a photo in chat. Reply to this text to message us.`;
  } else {
    const trimmed = messageText.trim();
    if (!trimmed) {
      return { ok: false, error: "Empty message" };
    }
    body = `${trimmed}\n\n— ${shopName}\nReply to this text to continue.`;
  }
  if (body.length > CHAT_SMS_MAX_LEN) {
    body = body.slice(0, CHAT_SMS_MAX_LEN - 3) + "...";
  }
  try {
    await twilio.messages.create({
      body,
      from: FROM_NUMBER,
      to: normalized,
    });
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("Chat SMS send error:", err);
    return { ok: false, error: err };
  }
}

/** One-off test send (no JobSms row). Uses TWILIO_PHONE_NUMBER as from. */
export async function sendSmsTest(
  phoneNumber: string
): Promise<{ ok: boolean; error?: string }> {
  if (!twilio || !FROM_NUMBER) {
    return { ok: false, error: "SMS not configured" };
  }
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { ok: false, error: "Invalid phone number" };
  }
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const body = `${shopName}: SMS test — if you received this, Twilio is working.`;
  try {
    await twilio.messages.create({
      body,
      from: FROM_NUMBER,
      to: normalized,
    });
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    console.error("SMS test send error:", err);
    return { ok: false, error: err };
  }
}
