import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isReservedSubdomain,
  normalizeShopSubdomain,
} from "@/lib/tenant-domain";
import { sendPlatformSignupNotification, sendSignupVerificationEmail } from "@/lib/email";
import {
  createSignupVerificationToken,
  getSignupVerificationExpiry,
  getSignupVerificationUrl,
  isSubdomainTaken,
  buildTenantUrl,
  completeSignupFromToken,
} from "@/lib/signup-verification";

export const dynamic = "force-dynamic";

const signupSchema = z.object({
  shopName: z.string().trim().min(2, "Shop name is required").max(120),
  subdomain: z
    .string()
    .trim()
    .min(3, "Subdomain must be at least 3 characters")
    .max(30, "Subdomain must be 30 characters or less")
    .transform(normalizeShopSubdomain)
    .refine((value) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value), {
      message: "Use only letters, numbers, and hyphens",
    })
    .refine((value) => !isReservedSubdomain(value), {
      message: "That subdomain is reserved",
    }),
  ownerName: z.string().trim().min(2, "Your name is required").max(120),
  email: z.string().trim().email("A valid email is required").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid signup details";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { shopName, subdomain, ownerName, email, password } = parsed.data;

  if (await isSubdomainTaken(subdomain)) {
    return NextResponse.json({ error: "That subdomain is already taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const token = createSignupVerificationToken();
  const expiresAt = getSignupVerificationExpiry();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.pendingSignup.deleteMany({
        where: {
          OR: [{ email }, { subdomain }],
        },
      });

      await tx.pendingSignup.create({
        data: {
          token,
          shopName,
          subdomain,
          ownerName,
          email,
          passwordHash,
          expiresAt,
        },
      });
    });
  } catch (error) {
    console.error("POST /api/signup pending create error:", error);
    return NextResponse.json({ error: "Could not start signup" }, { status: 500 });
  }

  const verificationUrl = getSignupVerificationUrl(token, request);
  const emailResult = await sendSignupVerificationEmail({
    ownerName,
    ownerEmail: email,
    shopName,
    verificationUrl,
  });

  if (!emailResult.ok) {
    await prisma.pendingSignup.deleteMany({ where: { token } }).catch(() => {});
    return NextResponse.json(
      {
        error:
          emailResult.error === "Email not configured"
            ? "Email verification is not available right now. Please try again later."
            : "Could not send verification email. Please check your email address and try again.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      message: "Check your email to confirm your address and finish creating your workspace.",
      email,
    },
    { status: 202 },
  );
}

const verifySchema = z.object({
  token: z.string().min(1),
});

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await completeSignupFromToken(parsed.data.token);
  if (!result.ok) {
    const status =
      result.reason === "expired" ? 410 : result.reason === "subdomain_taken" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const loginUrl = buildTenantUrl(request, result.shop.subdomain, "/login");

  void sendPlatformSignupNotification({
    shopName: result.shop.name,
    subdomain: result.shop.subdomain,
    ownerName: result.ownerName,
    ownerEmail: result.ownerEmail,
    trialEndsAt: result.shop.trialEndsAt,
    loginUrl,
  }).catch((err) => console.error("[Signup] Platform notification email failed:", err));

  return NextResponse.json({
    shop: {
      id: result.shop.id,
      name: result.shop.name,
      subdomain: result.shop.subdomain,
    },
    loginUrl,
  });
}
