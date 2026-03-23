import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { sendChatMagicLinkEmail } from "@/lib/email";
import { z } from "zod";

export const runtime = "nodejs";

const EXPIRY_MINUTES = 15;
const schema = z.object({ customerId: z.string().min(1) });

/**
 * Staff-only: Send a magic link email to a customer so they can access chat.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId } = schema.parse(body);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const email = customer.email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "Customer has no email address" },
        { status: 400 }
      );
    }

    const { randomBytes } = await import("crypto");
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + EXPIRY_MINUTES);

    await prisma.magicLinkToken.create({
      data: { token, customerId: customer.id, expiresAt },
    });

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const magicLinkUrl = `${baseUrl}/api/chat/verify?token=${token}`;

    // Create Resend client inline (same pattern as /api/email/test) to ensure env var is read at request time
    const resend = process.env.RESEND_API_KEY?.trim()
      ? new Resend(process.env.RESEND_API_KEY!.trim())
      : null;
    if (!resend) {
      return NextResponse.json(
        { error: "Email not configured. Add RESEND_API_KEY to Vercel environment variables." },
        { status: 500 }
      );
    }
    const { ok, error } = await sendChatMagicLinkEmail(email, magicLinkUrl, resend);

    if (!ok) {
      return NextResponse.json(
        { error: error ?? "Failed to send invite email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Sign-in link sent to ${email}`,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error("Chat send-invite error:", e);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
