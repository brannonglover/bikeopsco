import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";
import { requestHost, requestOrigin } from "@/lib/request-host";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  PASSWORD_RESET_EXPIRY_MINUTES,
  buildPasswordResetUrl,
  issuePasswordResetToken,
  resetPasswordWithToken,
} from "@/lib/password-reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GENERIC_REQUEST_MESSAGE =
  "If that email belongs to an account here, we've sent a link to reset your password.";

const requestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").transform((value) => value.toLowerCase()),
});

/** Step 1: email a reset link. The answer is the same whether or not the account exists. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a valid email address";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const shop = await getShopForHost(requestHost(request.headers));
  const origin = requestOrigin(request.headers);
  if (!shop || !origin) {
    return NextResponse.json({ error: "Shop not found." }, { status: 404 });
  }

  // The lookup and send run after the response, so how long the request takes
  // doesn't reveal whether the address has an account.
  waitUntil(
    sendResetLink(shop, origin, parsed.data.email).catch((err) =>
      console.error("[password-reset] Failed to send reset link:", err),
    ),
  );

  return NextResponse.json({ message: GENERIC_REQUEST_MESSAGE }, { status: 202 });
}

async function sendResetLink(
  shop: { id: string; name: string },
  origin: string,
  email: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { shopId_email: { shopId: shop.id, email } },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;

  const issued = await issuePasswordResetToken(user.id);
  if (!issued.ok) {
    console.warn(`[password-reset] Throttled reset request for user ${user.id}`);
    return;
  }

  const result = await sendPasswordResetEmail({
    userName: user.name,
    userEmail: user.email,
    shopName: shop.name,
    resetUrl: buildPasswordResetUrl(origin, issued.token),
    expiresInMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
  });
  if (!result.ok) {
    console.error(`[password-reset] Email to user ${user.id} not sent: ${result.error}`);
  }
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

/** Step 2: spend the link on a new password. */
export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "password") {
      return NextResponse.json({ error: issue.message }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const shop = await getShopForHost(requestHost(request.headers));
  if (!shop) {
    return NextResponse.json({ error: "Shop not found." }, { status: 404 });
  }

  const result = await resetPasswordWithToken(parsed.data.token, parsed.data.password, shop.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "expired" ? 410 : 400 });
  }

  return NextResponse.json({ ok: true });
}
