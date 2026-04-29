import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  DEFAULT_ROOT_DOMAIN,
  isReservedSubdomain,
  normalizeShopSubdomain,
} from "@/lib/tenant-domain";
import { provisionShopDefaults } from "@/lib/shop-provisioning";
import { addTrialDays } from "@/lib/billing";

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

function buildTenantUrl(request: NextRequest, subdomain: string, path = "/login"): string {
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

  const existingShop = await prisma.shop.findUnique({
    where: { subdomain },
    select: { id: true },
  });
  if (existingShop) {
    return NextResponse.json({ error: "That subdomain is already taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const shop = await prisma.$transaction(async (tx) => {
      const createdShop = await tx.shop.create({
        data: {
          name: shopName,
          subdomain,
          billingStatus: "trialing",
          trialEndsAt: addTrialDays(),
        },
      });

      await tx.user.create({
        data: {
          shopId: createdShop.id,
          email,
          passwordHash,
          name: ownerName,
        },
      });

      await provisionShopDefaults(tx, createdShop.id, shopName);
      return createdShop;
    });

    const loginUrl = buildTenantUrl(request, shop.subdomain, "/login");
    return NextResponse.json(
      {
        shop: {
          id: shop.id,
          name: shop.name,
          subdomain: shop.subdomain,
        },
        loginUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "That subdomain is already taken" }, { status: 409 });
    }
    console.error("POST /api/signup error:", error);
    return NextResponse.json({ error: "Could not create shop" }, { status: 500 });
  }
}
