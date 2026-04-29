import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found." }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: {
        shopId_email: { shopId: shop.id, email: email.trim().toLowerCase() },
      },
    });

    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        shopId: shop.id,
        shopSubdomain: shop.subdomain,
      },
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: 30 * 24 * 60 * 60,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        shopId: shop.id,
        shopSubdomain: shop.subdomain,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
