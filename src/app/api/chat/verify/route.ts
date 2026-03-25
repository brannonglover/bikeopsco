import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, getSessionCookieName } from "@/lib/chat-session";
import { z } from "zod";

const postBodySchema = z.object({ token: z.string().min(1) });

function setSessionCookie(response: NextResponse, sessionToken: string) {
  response.cookies.set(getSessionCookieName(), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
}

type ConsumeResult =
  | { ok: true; sessionToken: string }
  | { ok: false; reason: "invalid" | "expired" };

async function consumeMagicLink(token: string): Promise<ConsumeResult> {
  const magicLink = await prisma.magicLinkToken.findUnique({
    where: { token },
    include: { customer: true },
  });

  if (!magicLink) {
    return { ok: false, reason: "invalid" };
  }
  if (magicLink.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }

  const sessionToken = await createSession(magicLink.customerId);
  await prisma.magicLinkToken.delete({ where: { id: magicLink.id } }).catch(() => {});

  return { ok: true, sessionToken };
}

/**
 * Legacy: GET with query token (vulnerable to email link scanners prefetching the URL).
 * Kept so old emails still work.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/chat/c?error=invalid", request.url));
  }

  const result = await consumeMagicLink(token);
  if (!result.ok) {
    const err = result.reason === "expired" ? "expired" : "invalid";
    return NextResponse.redirect(new URL(`/chat/c?error=${err}`, request.url));
  }

  const response = NextResponse.redirect(new URL("/chat/c", request.url));
  setSessionCookie(response, result.sessionToken);
  return response;
}

/**
 * Preferred: POST after the browser loads /chat/c#token=… — scanners don't send the fragment
 * to the server, so the token isn't consumed until the user opens the page and JS runs.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = postBodySchema.parse(body);
    const result = await consumeMagicLink(token);

    if (!result.ok) {
      const status = result.reason === "expired" ? 410 : 400;
      const code = result.reason === "expired" ? "expired" : "invalid";
      return NextResponse.json({ error: code }, { status });
    }

    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    console.error("Chat verify POST error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
