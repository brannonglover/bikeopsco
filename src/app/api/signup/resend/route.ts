import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sendSignupVerificationEmail } from "@/lib/email";
import { normalizeShopSubdomain } from "@/lib/tenant-domain";
import {
  createSignupVerificationToken,
  getSignupVerificationExpiry,
  getSignupVerificationUrl,
} from "@/lib/signup-verification";

export const dynamic = "force-dynamic";

const RESEND_COOLDOWN_MS = 60_000;

const resendSchema = z.object({
  email: z
    .string()
    .trim()
    .email("A valid email is required")
    .transform((value) => value.toLowerCase()),
  subdomain: z
    .string()
    .trim()
    .min(1)
    .transform(normalizeShopSubdomain)
    .optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { email, subdomain } = parsed.data;
  const now = new Date();

  const pending = await prisma.pendingSignup.findFirst({
    where: {
      email,
      ...(subdomain ? { subdomain } : {}),
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!pending) {
    return NextResponse.json(
      {
        error:
          "No pending signup found for that email. It may have expired or already been confirmed.",
      },
      { status: 404 },
    );
  }

  const elapsedMs = now.getTime() - pending.createdAt.getTime();
  if (elapsedMs < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
    return NextResponse.json(
      {
        error: `Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before requesting another email.`,
      },
      { status: 429 },
    );
  }

  const token = createSignupVerificationToken();
  const expiresAt = getSignupVerificationExpiry();

  try {
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: {
        token,
        expiresAt,
        createdAt: now,
      },
    });
  } catch (error) {
    console.error("POST /api/signup/resend update error:", error);
    return NextResponse.json({ error: "Could not refresh signup verification" }, { status: 500 });
  }

  const verificationUrl = getSignupVerificationUrl(token, request);
  const emailResult = await sendSignupVerificationEmail({
    ownerName: pending.ownerName,
    ownerEmail: pending.email,
    shopName: pending.shopName,
    verificationUrl,
  });

  if (!emailResult.ok) {
    return NextResponse.json(
      {
        error:
          emailResult.error === "Email not configured"
            ? "Email verification is not available right now. Please try again later."
            : "Could not send verification email. Please try again.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    message: `We sent another confirmation email to ${pending.email}.`,
    email: pending.email,
  });
}
