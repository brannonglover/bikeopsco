import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";

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
        jobProducts: { include: { product: true } },
        payments: {
          select: {
            amount: true,
            status: true,
            stripePaymentIntentId: true,
            paymentMethod: true,
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const subtotal = computeJobSubtotal({
      jobServices: job.jobServices,
      jobProducts: job.jobProducts,
    });
    const totalPaid = computeTotalPaid(job.payments);
    const paymentSummary = getJobPaymentSummary({
      currentStatus: job.paymentStatus,
      subtotal,
      totalPaid,
    });

    if (subtotal <= 0) {
      return NextResponse.json(
        { error: "Job has no services, products, or total is zero" },
        { status: 400 }
      );
    }

    if (paymentSummary.isPaidInFull || paymentSummary.remaining <= 0) {
      return NextResponse.json(
        { error: "Job is already paid" },
        { status: 400 }
      );
    }

    const amount = paymentSummary.remaining;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        paymentStatus: "PAID",
        payments: {
          create: {
            amount: amount.toFixed(2),
            currency: "usd",
            status: "succeeded",
            paymentMethod: "cash",
          },
        },
      },
    });

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
        service: js.service ? { name: js.service.name } : null,
        customServiceName: js.customServiceName,
        quantity: js.quantity,
        unitPrice: Number(js.unitPrice),
      })),
      jobProducts: (job.jobProducts ?? []).map((jp) => ({
        product: { name: jp.product?.name ?? "Product" },
        quantity: jp.quantity,
        unitPrice: Number(jp.unitPrice),
      })),
    };

    const recipientEmail = job.customer?.email?.trim();
    if (jobForEmail && recipientEmail) {
      const result = await sendPaymentReceiptEmail(jobForEmail, amount);
      if (!result.ok) {
        console.error("Payment receipt email failed for cash payment:", result.error);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Cash payment recorded",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("POST /api/jobs/[id]/payments/record-cash error:", error);
    return NextResponse.json(
      { error: "Failed to record cash payment", details: msg },
      { status: 500 }
    );
  }
}
