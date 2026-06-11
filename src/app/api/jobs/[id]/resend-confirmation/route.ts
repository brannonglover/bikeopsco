import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { getTemplateForStage, sendBookingConfirmationForJob } from "@/lib/email";
import { getEffectiveEmailUpdatesConsent } from "@/lib/sms-consent";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const { id: jobId } = params;

    const job = await prisma.job.findFirst({
      where: { id: jobId, shopId: auth.shop.id },
      include: { customer: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.stage !== "BOOKED_IN" && job.stage !== "PENDING_APPROVAL") {
      return NextResponse.json(
        {
          error:
            "Booking confirmation can only be resent for jobs in Booked In or Pending approval.",
        },
        { status: 400 }
      );
    }

    const email = getEffectiveEmailUpdatesConsent(job.customer)
      ? job.customer?.email?.trim()
      : null;
    if (!email) {
      return NextResponse.json(
        {
          error:
            "No customer email on this job, or the customer has opted out of email updates.",
        },
        { status: 400 }
      );
    }

    const templateSlug = getTemplateForStage("BOOKED_IN", job.deliveryType);
    if (!templateSlug) {
      return NextResponse.json(
        { error: "Booking confirmation email template is not configured." },
        { status: 500 }
      );
    }

    const result = await sendBookingConfirmationForJob(jobId, { force: true });

    if (!result.ok) {
      const hint =
        result.error?.includes("domain") || result.error?.includes("Resend")
          ? " Verify your FROM_EMAIL domain in Resend dashboard."
          : "";
      return NextResponse.json(
        {
          error: result.error ?? "Failed to send booking confirmation",
          details: result.error,
          hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Booking confirmation sent to ${result.recipient ?? email}`,
    });
  } catch (error) {
    console.error("POST /api/jobs/[id]/resend-confirmation error:", error);
    return NextResponse.json(
      { error: "Failed to resend booking confirmation" },
      { status: 500 }
    );
  }
}
