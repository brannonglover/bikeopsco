import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, getSessionCookieName } from "@/lib/chat-session";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/chat/c?error=invalid", request.url));
  }

  const magicLink = await prisma.magicLinkToken.findUnique({
    where: { token },
    include: { customer: true },
  });

  if (!magicLink || magicLink.expiresAt < new Date()) {
    return NextResponse.redirect(new URL("/chat/c?error=expired", request.url));
  }

  const sessionToken = await createSession(magicLink.customerId);

  await prisma.magicLinkToken.delete({ where: { id: magicLink.id } }).catch(() => {});

  const response = NextResponse.redirect(new URL("/chat/c", request.url));
  response.cookies.set(getSessionCookieName(), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return response;
}
