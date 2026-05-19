import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createPlatformAdminSessionToken,
  getPlatformAdminEmail,
  isPlatformAdminConfigured,
  platformAdminCookieOptions,
  PLATFORM_ADMIN_COOKIE,
  verifyPlatformAdminCredentials,
} from "@/lib/platform-admin";
import { isPlatformAdminHost } from "@/lib/platform-admin-host";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  if (!isPlatformAdminHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isPlatformAdminConfigured()) {
    return NextResponse.json(
      { error: "Platform admin is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const valid = await verifyPlatformAdminCredentials(email, password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const configuredEmail = getPlatformAdminEmail();
  if (!configuredEmail) {
    return NextResponse.json({ error: "Platform admin is not configured." }, { status: 503 });
  }

  const sessionToken = await createPlatformAdminSessionToken(configuredEmail);
  if (!sessionToken) {
    return NextResponse.json({ error: "Could not create session." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PLATFORM_ADMIN_COOKIE, sessionToken, platformAdminCookieOptions());
  return response;
}
