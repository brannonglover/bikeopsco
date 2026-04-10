import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { getAppUrl, getResendApiKey } from "@/lib/env";
import { sendChatMagicLinkEmail } from "@/lib/email";
import { z } from "zod";

export const runtime = "nodejs";
const EXPIRY_MINUTES = 15;

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = schema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
    });

    // Always return success - don't reveal if email exists
    const baseUrl = getAppUrl();

    if (!customer) {
      return NextResponse.json({
        message: "If that email is on file, we've sent you a sign-in link. Check your inbox.",
      });
    }

    const { randomBytes } = await import("crypto");
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + EXPIRY_MINUTES);

    await prisma.magicLinkToken.create({
      data: { token, customerId: customer.id, expiresAt },
    });

    const magicLinkUrl = `${baseUrl}/chat/c#token=${encodeURIComponent(token)}`;

    const apiKey = getResendApiKey();
    console.log("[request-login] apiKey present:", !!apiKey, "| baseUrl:", baseUrl || "(empty)");
    const resend = apiKey ? new Resend(apiKey) : null;
    const { ok, error } = await sendChatMagicLinkEmail(email.trim(), magicLinkUrl, resend);

    if (!ok) {
      console.error("[request-login] sendChatMagicLinkEmail failed:", error);
      return NextResponse.json(
        { error: "Failed to send sign-in email. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "If that email is on file, we've sent you a sign-in link. Check your inbox.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    console.error("Chat request-login error:", e);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
