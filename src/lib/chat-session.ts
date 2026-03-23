import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const SESSION_COOKIE_NAME = "chat_session";
const SESSION_DAYS = 30;

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export async function getCustomerFromSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.chatSession.findUnique({
    where: { token },
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  return session.customerId;
}

export async function createSession(customerId: string): Promise<string> {
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await prisma.chatSession.create({
    data: { token, customerId, expiresAt },
  });

  return token;
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}
