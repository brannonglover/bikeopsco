import "server-only";

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import {
  getPlatformAdminEmail,
  PLATFORM_ADMIN_COOKIE,
  type PlatformAdminSession,
} from "@/lib/platform-admin-session";

async function decodePlatformAdminToken(
  token: string | undefined,
): Promise<PlatformAdminSession | null> {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || !token) return null;

  const decoded = await decode({ token, secret });
  if (!decoded || decoded.role !== "platform_admin" || typeof decoded.email !== "string") {
    return null;
  }

  const configuredEmail = getPlatformAdminEmail();
  if (!configuredEmail || decoded.email !== configuredEmail) {
    return null;
  }

  return {
    email: decoded.email,
    role: "platform_admin",
  };
}

export async function getPlatformAdminSessionFromCookies(): Promise<PlatformAdminSession | null> {
  const cookieStore = await cookies();
  return decodePlatformAdminToken(cookieStore.get(PLATFORM_ADMIN_COOKIE)?.value);
}
