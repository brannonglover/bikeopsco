import "server-only";

import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPlatformAdminHost } from "@/lib/platform-admin-host";
import {
  getPlatformAdminEmail,
  getPlatformAdminSession,
  PLATFORM_ADMIN_MAX_AGE_SECONDS,
  type PlatformAdminSession,
} from "@/lib/platform-admin-session";

export {
  getPlatformAdminEmail,
  getPlatformAdminSession,
  platformAdminCookieOptions,
  PLATFORM_ADMIN_COOKIE,
  PLATFORM_ADMIN_MAX_AGE_SECONDS,
  type PlatformAdminSession,
} from "@/lib/platform-admin-session";

function getPlatformAdminSecret(): string | null {
  return process.env.NEXTAUTH_SECRET?.trim() || null;
}

function getPlatformAdminPassword(): string | null {
  return process.env.PLATFORM_ADMIN_PASSWORD?.trim() || null;
}

export function isPlatformAdminConfigured(): boolean {
  return !!(getPlatformAdminEmail() && getPlatformAdminPassword() && getPlatformAdminSecret());
}

export async function verifyPlatformAdminCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  const configuredEmail = getPlatformAdminEmail();
  const configuredPassword = getPlatformAdminPassword();
  if (!configuredEmail || !configuredPassword) return false;

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== configuredEmail) return false;

  if (configuredPassword.startsWith("$2")) {
    return bcrypt.compare(password, configuredPassword);
  }

  return password === configuredPassword;
}

export async function createPlatformAdminSessionToken(
  email: string,
): Promise<string | null> {
  const secret = getPlatformAdminSecret();
  if (!secret) return null;

  return encode({
    token: {
      email: email.trim().toLowerCase(),
      role: "platform_admin",
    } satisfies PlatformAdminSession,
    secret,
    maxAge: PLATFORM_ADMIN_MAX_AGE_SECONDS,
  });
}

type RequirePlatformAdminResult =
  | { ok: true; session: PlatformAdminSession }
  | { ok: false; response: NextResponse };

export async function requirePlatformAdmin(
  request: NextRequest,
): Promise<RequirePlatformAdminResult> {
  if (!isPlatformAdminHost(request.headers.get("host"))) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const session = await getPlatformAdminSession(request);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true, session };
}
