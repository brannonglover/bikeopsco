import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { getStripe, toCents, fromCents } from "@/lib/stripe";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";
import { z } from "zod";

const bodySchema = z.object({
  amount: z
    .number()
    .positive("Refund amount must be greater than zero"),
  reason: z
    .enum(["requested_by_customer", "duplicate", "fraudulent"])
    .optional()
    .default("requested_by_customer"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const { id: jobId } = params;
    const body = await request.json().catch(() => ({}));
    const { amount: refundAmount, reason } = bodySchema.parse(body);

    const job = await prisma.job.findFirst({
      where: { id: jobId, shopId: auth.shop.id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        jobServices: true,
        jobProducts: true,
        payments: {
          select: {
            id: true,
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

    if (totalPaid <= 0) {
      return NextResponse.json(
        { error: "No payments have been made on this job" },
        { status: 400 }
      );
    }

    if (refundAmount > totalPaid) {
      return NextResponse.json(
        { error: `Refund amount ($${refundAmount.toFixed(2)}) exceeds total paid ($${totalPaid.toFixed(2)})` },
        { status: 400 }
      );
    }

    const stripePayments = job.payments.filter(
      (p) =>
        p.stripePaymentIntentId &&
        p.status === "succeeded" &&
        p.paymentMethod !== "cash"
    );

    const cashPayments = job.payments.filter(
      (p) => p.paymentMethod === "cash" && p.status === "succeeded"
    );

    const totalStripe = stripePayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    const refundCents = toCents(refundAmount);
    const stripeRefundCents = Math.min(refundCents, toCents(totalStripe));
    const cashRefundCents = refundCents - stripeRefundCents;

    const stripe = getStripe();

    if (stripeRefundCents > 0) {
      let remainingCents = stripeRefundCents;

      for (const payment of stripePayments) {
        if (remainingCents <= 0) break;

        const paymentAmountCents = toCents(Number(payment.amount));
        const thisRefundCents = Math.min(remainingCents, paymentAmountCents);

        await stripe.refunds.create({
          payment_intent: payment.stripePaymentIntentId!,
          amount: thisRefundCents,
          reason,
        });

        remainingCents -= thisRefundCents;
      }
    }

    await prisma.payment.create({
      data: {
        shopId: job.shopId,
        jobId,
        amount: (-refundAmount).toFixed(2),
        currency: "usd",
        status: "succeeded",
        paymentMethod: "refund",
      },
    });

    const updatedJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        jobServices: true,
        jobProducts: true,
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

    if (updatedJob) {
      const updatedSubtotal = computeJobSubtotal({
        jobServices: updatedJob.jobServices,
        jobProducts: updatedJob.jobProducts,
      });
      const updatedTotalPaid = computeTotalPaid(updatedJob.payments);
      const paymentSummary = getJobPaymentSummary({
        currentStatus: updatedJob.paymentStatus,
        subtotal: updatedSubtotal,
        totalPaid: updatedTotalPaid,
      });

      const newStatus =
        updatedTotalPaid <= 0 ? "REFUNDED" : paymentSummary.paymentStatus;

      await prisma.job.update({
        where: { id: jobId },
        data: { paymentStatus: newStatus },
      });
    }

    return NextResponse.json({
      success: true,
      refundedAmount: refundAmount,
      stripeRefunded: fromCents(stripeRefundCents),
      cashRefunded: fromCents(cashRefundCents),
      message:
        cashRefundCents > 0
          ? `Refunded $${refundAmount.toFixed(2)} ($${fromCents(stripeRefundCents).toFixed(2)} via Stripe, $${fromCents(cashRefundCents).toFixed(2)} was cash — hand that back to the customer).`
          : `Refunded $${refundAmount.toFixed(2)} via Stripe. The customer will see it in 5–10 business days.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }

    const err = error as { type?: string; message?: string };
    console.error("POST /api/jobs/[id]/payments/refund error:", error);

    if (err.type?.startsWith("Stripe") && typeof err.message === "string") {
      return NextResponse.json(
        { error: `Stripe: ${err.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to process refund" },
      { status: 500 }
    );
  }
}
