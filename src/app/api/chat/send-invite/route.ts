import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { getAppUrl, getResendApiKey } from "@/lib/env";
import { sendChatMagicLinkEmail } from "@/lib/email";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPIRY_MINUTES = 15;
const schema = z.object({ customerId: z.string().min(1) });

/**
 * Staff-only: Send a magic link email to a customer so they can access chat.
 */
export async function POST(request: NextRequest) {
  try {
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const body = await request.json();
    const { customerId } = schema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
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
      data: { shopId: shop.id, token, customerId: customer.id, expiresAt },
    });

    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const baseUrl = host ? `${proto}://${host}` : getAppUrl();
    // Fragment so link scanners don't prefetch and burn the one-time token (GET never sees #…).
    const magicLinkUrl = `${baseUrl}/chat/c#token=${encodeURIComponent(token)}`;

    const apiKey = getResendApiKey();
    const resend = apiKey ? new Resend(apiKey) : null;
    if (!resend) {
      return NextResponse.json(
        { error: "Email not configured. Add RESEND_API_KEY or BIKEOPS_RESEND_API_KEY to Vercel." },
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
