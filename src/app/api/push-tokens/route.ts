import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getCustomerFromSession } from "@/lib/chat-session";

const registerSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

/**
 * Determines who is making the request.
 * Staff: validated via NextAuth session (JWT cookie).
 * Customer: validated via chat_session cookie.
 * Returns the identity or null if unauthenticated.
 */
async function resolveIdentity(
  req: NextRequest
): Promise<
  | { kind: "staff"; userId: string }
  | { kind: "customer"; customerId: string }
  | null
> {
  // Try getToken first: it accepts both the plain and __Secure- cookie variants,
  // which makes it compatible with the mobile app regardless of which name it stored.
  const jwtToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (jwtToken?.id) {
    return { kind: "staff", userId: jwtToken.id as string };
  }

  // Fall back to getServerSession for any browser-based staff sessions.
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return { kind: "staff", userId: session.user.id };
  }

  const customerId = await getCustomerFromSession();
  if (customerId) {
    return { kind: "customer", customerId };
  }

  return null;
}

/** POST /api/push-tokens — register a push token for the current user. */
export async function POST(request: NextRequest) {
  const identity = await resolveIdentity(request);
  if (!identity) {
    console.warn("[push-tokens] POST — resolveIdentity returned null. Cookie header:", request.headers.get("cookie")?.slice(0, 60), "Auth header:", request.headers.get("authorization")?.slice(0, 30));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log("[push-tokens] POST — identity resolved:", identity.kind, identity.kind === "staff" ? identity.userId : identity.customerId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { token, platform } = parsed.data;

  try {
    await prisma.pushToken.upsert({
      where: { token },
      update: {
        platform,
        ...(identity.kind === "staff"
          ? { userId: identity.userId, customerId: null }
          : { customerId: identity.customerId, userId: null }),
        updatedAt: new Date(),
      },
      create: {
        token,
        platform,
        ...(identity.kind === "staff"
          ? { userId: identity.userId }
          : { customerId: identity.customerId }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push-tokens error:", err);
    return NextResponse.json({ error: "Failed to save push token" }, { status: 500 });
  }
}

/** DELETE /api/push-tokens?token=... — unregister a push token. */
export async function DELETE(request: NextRequest) {
  const identity = await resolveIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token query param required" }, { status: 400 });
  }

  try {
    await prisma.pushToken.deleteMany({ where: { token } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/push-tokens error:", err);
    return NextResponse.json({ error: "Failed to delete push token" }, { status: 500 });
  }
}
