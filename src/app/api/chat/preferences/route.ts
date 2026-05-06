import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { z } from "zod";
import {
  buildEmailUpdatesConsentUpdate,
  buildSmsConsentUpdate,
  getEffectiveEmailUpdatesConsent,
  getEffectiveSmsConsent,
} from "@/lib/sms-consent";

const updatePreferencesSchema = z
  .object({
    emailUpdatesConsent: z.boolean(),
    smsConsent: z.boolean(),
  })
  .refine((data) => data.emailUpdatesConsent || data.smsConsent, {
    message: "Choose at least one way to receive updates.",
  });

export const dynamic = "force-dynamic";

async function getCurrentCustomer() {
  const customerId = await getCustomerFromSession();
  if (!customerId) return null;
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      emailUpdatesConsent: true,
      smsConsent: true,
      smsConsentUpdatedAt: true,
    },
  });
}

export async function GET() {
  const features = await getAppFeatures();
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }

  const customer = await getCurrentCustomer();
  if (!customer) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json({
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    emailUpdatesConsent: getEffectiveEmailUpdatesConsent(customer),
    smsConsent: getEffectiveSmsConsent(customer),
  });
}

export async function PATCH(request: NextRequest) {
  const features = await getAppFeatures();
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const data = updatePreferencesSchema.parse(body);
    const customer = await getCurrentCustomer();
    if (!customer) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    if (data.emailUpdatesConsent && !customer.email?.trim()) {
      return NextResponse.json({ error: "This customer does not have an email address on file." }, { status: 400 });
    }
    if (data.smsConsent && !customer.phone?.trim()) {
      return NextResponse.json({ error: "This customer does not have a phone number on file." }, { status: 400 });
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...buildEmailUpdatesConsentUpdate(data.emailUpdatesConsent, "CUSTOMER_PREFERENCES"),
        ...buildSmsConsentUpdate(data.smsConsent, "CUSTOMER_PREFERENCES"),
      },
      select: {
        email: true,
        phone: true,
        emailUpdatesConsent: true,
        smsConsent: true,
        smsConsentUpdatedAt: true,
      },
    });

    return NextResponse.json({
      emailUpdatesConsent: getEffectiveEmailUpdatesConsent(updated),
      smsConsent: getEffectiveSmsConsent(updated),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid preferences" }, { status: 400 });
    }
    console.error("PATCH /api/chat/preferences error:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
