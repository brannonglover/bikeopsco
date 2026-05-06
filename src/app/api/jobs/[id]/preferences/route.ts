import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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

async function getCustomerForJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      customerId: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          emailUpdatesConsent: true,
          emailUpdatesConsentSource: true,
          emailUpdatesConsentUpdatedAt: true,
          smsConsent: true,
          smsConsentSource: true,
          smsConsentUpdatedAt: true,
        },
      },
    },
  });

  return job?.customerId && job.customer ? job.customer : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const customer = await getCustomerForJob(params.id);
    if (!customer) {
      return NextResponse.json({ error: "Customer not found for this job" }, { status: 404 });
    }

    return NextResponse.json({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      emailUpdatesConsent: getEffectiveEmailUpdatesConsent(customer),
      smsConsent: getEffectiveSmsConsent(customer),
    });
  } catch (error) {
    console.error("GET /api/jobs/[id]/preferences error:", error);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const data = updatePreferencesSchema.parse(body);
    const customer = await getCustomerForJob(params.id);
    if (!customer) {
      return NextResponse.json({ error: "Customer not found for this job" }, { status: 404 });
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
    console.error("PATCH /api/jobs/[id]/preferences error:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
