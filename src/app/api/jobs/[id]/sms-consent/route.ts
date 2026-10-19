import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { buildSmsConsentUpdate, getEffectiveSmsConsent } from "@/lib/sms-consent";
import { hasJobReadAccess } from "@/lib/job-customer-access";
import { getShopForHost } from "@/lib/shop";

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
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }
    const body = await request.json();
    const data = updateSmsConsentSchema.parse(body);

    // Only this shop's job, and only for staff, the job's tracking link, or
    // the customer who owns it — the same rule as the preferences route.
    const job = await prisma.job.findFirst({
      where: { id, shopId: shop.id },
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

    if (
      !job?.customerId ||
      !job.customer ||
      !(await hasJobReadAccess(request, shop.id, id, job.customerId))
    ) {
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
