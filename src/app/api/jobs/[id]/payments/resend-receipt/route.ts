import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: jobId } = params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: true,
        jobServices: { include: { service: true } },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.paymentStatus !== "PAID") {
      return NextResponse.json(
        { error: "Job is not paid" },
        { status: 400 }
      );
    }

    const email = job.customer?.email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "No customer email. Add a customer with an email address to this job." },
        { status: 400 }
      );
    }

    const jobForEmail = {
      id: job.id,
      bikeMake: job.bikeMake,
      bikeModel: job.bikeModel,
      customer: job.customer
        ? {
            firstName: job.customer.firstName,
            lastName: job.customer.lastName,
            email: job.customer.email,
          }
        : null,
      jobServices: job.jobServices.map((js) => ({
        service: { name: js.service.name },
        quantity: js.quantity,
        unitPrice: Number(js.unitPrice),
      })),
    };

    const result = await sendPaymentReceiptEmail(jobForEmail);

    if (!result.ok) {
      const hint =
        result.error?.includes("domain") || result.error?.includes("Resend")
          ? " Verify your FROM_EMAIL domain in Resend dashboard. onboarding@resend.dev can only send to your Resend account email."
          : "";
      return NextResponse.json(
        {
          error: result.error ?? "Failed to send receipt",
          details: result.error,
          hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Receipt sent to ${email}`,
    });
  } catch (error) {
    console.error("POST /api/jobs/[id]/payments/resend-receipt error:", error);
    return NextResponse.json(
      { error: "Failed to resend receipt" },
      { status: 500 }
    );
  }
}
