import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { addTrialDays } from "@/lib/billing";
import { getAppUrl } from "@/lib/env";
import { provisionShopDefaults } from "@/lib/shop-provisioning";
import {
  DEFAULT_ROOT_DOMAIN,
  SHARED_APP_SUBDOMAIN,
} from "@/lib/tenant-domain";

export const SIGNUP_VERIFICATION_EXPIRY_HOURS = 24;

export function createSignupVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getSignupVerificationExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SIGNUP_VERIFICATION_EXPIRY_HOURS);
  return expiresAt;
}

function buildSharedAppUrl(request: NextRequest): string {
  const rootDomain = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;
  const url = request.nextUrl.clone();

  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    url.hostname = `${SHARED_APP_SUBDOMAIN}.localhost`;
  } else if (url.hostname.endsWith(".lvh.me")) {
    url.hostname = `${SHARED_APP_SUBDOMAIN}.lvh.me`;
  } else {
    url.hostname = `${SHARED_APP_SUBDOMAIN}.${rootDomain}`;
    url.protocol = "https:";
    url.port = "";
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function getSignupVerificationUrl(
  token: string,
  request?: NextRequest,
): string {
  const base = getAppUrl() || (request ? buildSharedAppUrl(request) : "");
  return `${base}/signup/verify?token=${encodeURIComponent(token)}`;
}

export function buildTenantUrl(
  request: NextRequest,
  subdomain: string,
  path = "/login",
): string {
  const rootDomain = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;
  const url = request.nextUrl.clone();

  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    url.hostname = `${subdomain}.localhost`;
  } else if (url.hostname.endsWith(".lvh.me")) {
    url.hostname = `${subdomain}.lvh.me`;
  } else {
    url.hostname = `${subdomain}.${rootDomain}`;
    url.protocol = "https:";
    url.port = "";
  }

  url.pathname = path;
  url.search = "";
  return url.toString();
}

export async function isSubdomainTaken(subdomain: string): Promise<boolean> {
  const now = new Date();
  const [shop, pending] = await Promise.all([
    prisma.shop.findUnique({ where: { subdomain }, select: { id: true } }),
    prisma.pendingSignup.findFirst({
      where: { subdomain, expiresAt: { gt: now } },
      select: { id: true },
    }),
  ]);
  return Boolean(shop || pending);
}

type CompleteSignupResult =
  | {
      ok: true;
      shop: { id: string; name: string; subdomain: string; trialEndsAt: Date | null };
      ownerName: string;
      ownerEmail: string;
    }
  | { ok: false; reason: "invalid" | "expired" | "subdomain_taken" };

export async function completeSignupFromToken(token: string): Promise<CompleteSignupResult> {
  const pending = await prisma.pendingSignup.findUnique({ where: { token } });
  if (!pending) {
    return { ok: false, reason: "invalid" };
  }
  if (pending.expiresAt < new Date()) {
    await prisma.pendingSignup.delete({ where: { id: pending.id } }).catch(() => {});
    return { ok: false, reason: "expired" };
  }

  const existingShop = await prisma.shop.findUnique({
    where: { subdomain: pending.subdomain },
    select: { id: true },
  });
  if (existingShop) {
    await prisma.pendingSignup.delete({ where: { id: pending.id } }).catch(() => {});
    return { ok: false, reason: "subdomain_taken" };
  }

  const shop = await prisma.$transaction(async (tx) => {
    const createdShop = await tx.shop.create({
      data: {
        name: pending.shopName,
        subdomain: pending.subdomain,
        billingStatus: "trialing",
        trialEndsAt: addTrialDays(),
      },
    });

    await tx.user.create({
      data: {
        shopId: createdShop.id,
        email: pending.email,
        passwordHash: pending.passwordHash,
        name: pending.ownerName,
      },
    });

    await provisionShopDefaults(tx, createdShop.id, pending.shopName, pending.email);
    await tx.pendingSignup.delete({ where: { id: pending.id } });
    return createdShop;
  });

  return {
    ok: true,
    shop: {
      id: shop.id,
      name: shop.name,
      subdomain: shop.subdomain,
      trialEndsAt: shop.trialEndsAt,
    },
    ownerName: pending.ownerName,
    ownerEmail: pending.email,
  };
}
