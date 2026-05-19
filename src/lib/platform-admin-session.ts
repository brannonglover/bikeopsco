import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const PLATFORM_ADMIN_COOKIE = "platform-admin.session";
export const PLATFORM_ADMIN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type PlatformAdminSession = {
  email: string;
  role: "platform_admin";
};

function getPlatformAdminSecret(): string | null {
  return process.env.NEXTAUTH_SECRET?.trim() || null;
}

export function getPlatformAdminEmail(): string | null {
  return process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase() || null;
}

async function decodePlatformAdminToken(
  token: string | undefined,
): Promise<PlatformAdminSession | null> {
  const secret = getPlatformAdminSecret();
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

export async function getPlatformAdminSession(
  request: NextRequest,
): Promise<PlatformAdminSession | null> {
  return decodePlatformAdminToken(request.cookies.get(PLATFORM_ADMIN_COOKIE)?.value);
}

export async function getPlatformAdminSessionFromCookies(): Promise<PlatformAdminSession | null> {
  const cookieStore = await cookies();
  return decodePlatformAdminToken(cookieStore.get(PLATFORM_ADMIN_COOKIE)?.value);
}

export function platformAdminCookieOptions(maxAge = PLATFORM_ADMIN_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
