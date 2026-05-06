import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";

const SESSION_COOKIE_NAME = "chat_session";
const SESSION_DAYS = 30;
const SESSION_COOKIE_DAYS = 365;

const ACTIVE_CHAT_JOB_STAGES = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
] as const;

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function getSessionCookieMaxAgeSeconds(): number {
  return SESSION_COOKIE_DAYS * 24 * 60 * 60;
}

export async function customerHasActiveChatJob(
  shopId: string,
  customerId: string
): Promise<boolean> {
  const activeJob = await prisma.job.findFirst({
    where: {
      shopId,
      customerId,
      archivedAt: null,
      stage: { in: [...ACTIVE_CHAT_JOB_STAGES] },
    },
    select: { id: true },
  });

  return Boolean(activeJob);
}

export async function customerHasSmsChatAccess(
  shopId: string,
  customerId: string
): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId },
    select: {
      phone: true,
      smsConsent: true,
      smsConsentUpdatedAt: true,
    },
  });

  if (!getEffectiveSmsConsent(customer)) return false;
  return customerHasActiveChatJob(shopId, customerId);
}

export async function getCustomerFromSession(): Promise<string | null> {
  const shop = await requireCurrentShop();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.chatSession.findUnique({
    where: { token },
  });

  if (!session || session.shopId !== shop.id) {
    return null;
  }

  if (
    session.expiresAt < new Date() &&
    !(await customerHasSmsChatAccess(shop.id, session.customerId))
  ) {
    return null;
  }

  return session.customerId;
}

export async function createSession(customerId: string): Promise<string> {
  const shop = await requireCurrentShop();
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await prisma.chatSession.create({
    data: { shopId: shop.id, token, customerId, expiresAt },
  });

  return token;
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}
