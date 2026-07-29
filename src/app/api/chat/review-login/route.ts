import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  getSessionCookieMaxAgeSeconds,
  getSessionCookieName,
} from "@/lib/chat-session";
import {
  computeJobSubtotal,
  computeTotalPaid,
  getJobPaymentSummary,
} from "@/lib/job-payments";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** Temporary App Store Review customer login. Remove after approval. */
const DEFAULT_REVIEW_EMAIL = "appreview@bikeops.co";
const DEFAULT_REVIEW_SHOP = "bbm";
const DEMO_JOB_MARKER = "App Review Demo";
const DEMO_JOB_AMOUNT = 1;

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function passwordsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function reviewConfig(): {
  email: string;
  password: string;
  shopSubdomain: string;
} | null {
  const password = process.env.APPLE_REVIEW_PASSWORD?.trim();
  if (!password) return null;

  return {
    email: (
      process.env.APPLE_REVIEW_EMAIL?.trim() || DEFAULT_REVIEW_EMAIL
    ).toLowerCase(),
    password,
    shopSubdomain: (
      process.env.APPLE_REVIEW_SHOP_SUBDOMAIN?.trim() || DEFAULT_REVIEW_SHOP
    ).toLowerCase(),
  };
}

/** Ensure a $1 unpaid BIKE_READY job so reviewers can open Stripe + Apple Pay. */
async function ensureAppleReviewDemoJob(shopId: string, customerId: string) {
  const candidates = await prisma.job.findMany({
    where: {
      shopId,
      customerId,
      archivedAt: null,
      bikeModel: DEMO_JOB_MARKER,
    },
    include: {
      jobServices: { select: { unitPrice: true, quantity: true } },
      jobProducts: { select: { unitPrice: true, quantity: true } },
      payments: {
        select: {
          amount: true,
          status: true,
          paymentMethod: true,
          stripePaymentIntentId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const hasPayable = candidates.some((job) => {
    const subtotal = computeJobSubtotal({
      jobServices: job.jobServices,
      jobProducts: job.jobProducts,
    });
    const totalPaid = computeTotalPaid(job.payments);
    const summary = getJobPaymentSummary({
      currentStatus: job.paymentStatus,
      subtotal,
      totalPaid,
    });
    return (
      !summary.isPaidInFull &&
      summary.remaining > 0 &&
      [
        "RECEIVED",
        "WORKING_ON",
        "WAITING_ON_CUSTOMER",
        "WAITING_ON_PARTS",
        "BIKE_READY",
        "COMPLETED",
      ].includes(job.stage)
    );
  });

  if (hasPayable) return;

  await prisma.job.create({
    data: {
      shopId,
      customerId,
      bikeMake: "Demo",
      bikeModel: DEMO_JOB_MARKER,
      stage: "BIKE_READY",
      deliveryType: "DROP_OFF_AT_SHOP",
      paymentStatus: "UNPAID",
      notes: "Temporary App Store Review demo job for Apple Pay verification",
      receivedAt: new Date(),
      jobServices: {
        create: {
          shopId,
          customServiceName: "App Review demo service",
          quantity: 1,
          unitPrice: DEMO_JOB_AMOUNT,
        },
      },
    },
  });
}

export async function POST(request: NextRequest) {
  const config = reviewConfig();
  if (!config) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  if (email !== config.email || !passwordsMatch(parsed.data.password, config.password)) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const shop = await getShopForHost(request.headers.get("host"));
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  if (shop.subdomain.toLowerCase() !== config.shopSubdomain) {
    return NextResponse.json(
      {
        error: `App Review demo access is only available for the ${config.shopSubdomain} shop.`,
      },
      { status: 403 }
    );
  }

  let customer = await prisma.customer.findFirst({
    where: { shopId: shop.id, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        firstName: "App",
        lastName: "Reviewer",
        email,
        notes: "Temporary App Store Review demo account",
      },
      select: { id: true },
    });
  }

  await ensureAppleReviewDemoJob(shop.id, customer.id);

  const sessionToken = await createSession(customer.id);
  const response = NextResponse.json({
    ok: true,
    sessionToken,
  });
  response.cookies.set(getSessionCookieName(), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getSessionCookieMaxAgeSeconds(),
    path: "/",
  });
  return response;
}
