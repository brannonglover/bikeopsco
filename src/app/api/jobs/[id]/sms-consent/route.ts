import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { buildSmsConsentUpdate, getEffectiveSmsConsent } from "@/lib/sms-consent";

const updateSmsConsentSchema = z.object({
  smsConsent: z.boolean(),
});

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const data = updateSmsConsentSchema.parse(body);

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        customerId: true,
        customer: {
          select: {
            id: true,
            phone: true,
            smsConsent: true,
            smsConsentSource: true,
            smsConsentUpdatedAt: true,
          },
        },
      },
    });

    if (!job?.customerId || !job.customer) {
      return NextResponse.json(
        { error: "Customer not found for this job" },
        { status: 404 }
      );
    }

    const customer = await prisma.customer.update({
      where: { id: job.customerId },
      data: buildSmsConsentUpdate(data.smsConsent, "STATUS_PAGE"),
      select: {
        phone: true,
        smsConsent: true,
        smsConsentSource: true,
        smsConsentUpdatedAt: true,
      },
    });

    return NextResponse.json({
      smsConsent: getEffectiveSmsConsent(customer),
      smsConsentSource: customer.smsConsentSource,
      smsConsentUpdatedAt: customer.smsConsentUpdatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/jobs/[id]/sms-consent error:", error);
    return NextResponse.json(
      { error: "Failed to update text message preferences" },
      { status: 500 }
    );
  }
}
