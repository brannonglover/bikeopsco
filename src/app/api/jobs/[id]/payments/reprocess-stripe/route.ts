import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: jobId } = params;

  let paymentIntentId: string;
  try {
    const body = await request.json();
    paymentIntentId = (body.paymentIntentId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
    return NextResponse.json(
      { error: "A valid Stripe Payment Intent ID (starting with pi_) is required" },
      { status: 400 }
    );
  }

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

  if (paymentSummary.isPaidInFull || paymentSummary.remaining <= 0) {
    return NextResponse.json({ error: "Job is already marked as paid" }, { status: 400 });
  }

  const stripe = getStripe();
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method", "latest_charge"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not retrieve Payment Intent from Stripe: ${msg}` },
      { status: 400 }
    );
  }

  if (paymentIntent.metadata?.jobId !== jobId) {
    return NextResponse.json(
      { error: "This Payment Intent does not belong to this job" },
      { status: 400 }
    );
  }

  if (paymentIntent.status !== "succeeded") {
    return NextResponse.json(
      { error: `Payment Intent status is "${paymentIntent.status}", not "succeeded". Only succeeded payments can be applied.` },
      { status: 400 }
    );
  }

  // Check if already recorded (idempotent)
  const existing = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This Payment Intent has already been recorded. Refresh the page to see the updated status." },
      { status: 400 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const paymentAt = (() => {
        const latestCharge = paymentIntent.latest_charge;
        if (latestCharge && typeof latestCharge !== "string") {
          return new Date(latestCharge.created * 1000);
        }
        return new Date(paymentIntent.created * 1000);
      })();
      const amount = (paymentIntent.amount / 100).toFixed(2);
      const mode =
        typeof paymentIntent.metadata?.mode === "string" && paymentIntent.metadata.mode.trim()
          ? paymentIntent.metadata.mode.trim()
          : null;
      const pm = paymentIntent.payment_method;
      await tx.payment.create({
        data: {
          jobId,
          stripePaymentIntentId: paymentIntent.id,
          amount,
          currency: paymentIntent.currency ?? "usd",
          status: paymentIntent.status,
          createdAt: paymentAt,
          paymentMethod: mode ?? (pm ? (typeof pm === "string" ? pm : pm.type) : null),
        },
      });

      const jobWithPayments = await tx.job.findUnique({
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
      if (!jobWithPayments) {
        throw new Error(`Job ${jobId} not found while reprocessing payment`);
      }

      const jobBikes = await tx.jobBike.findMany({
        where: { jobId },
        select: { waitingOnPartsAt: true, completedAt: true },
      });
      const hasUnresolvedParts = jobBikes.some(
        (b) => b.waitingOnPartsAt !== null && b.completedAt === null
      );

      const updatedSubtotal = computeJobSubtotal({
        jobServices: jobWithPayments.jobServices,
        jobProducts: jobWithPayments.jobProducts,
      });
      const updatedTotalPaid = computeTotalPaid(jobWithPayments.payments);
      const updatedPaymentSummary = getJobPaymentSummary({
        currentStatus: jobWithPayments.paymentStatus,
        subtotal: updatedSubtotal,
        totalPaid: updatedTotalPaid,
      });

      await tx.job.update({
        where: { id: jobId },
        data: {
          paymentStatus: updatedPaymentSummary.paymentStatus,
          ...(updatedPaymentSummary.isPaidInFull
            ? hasUnresolvedParts
              ? { stage: "WAITING_ON_PARTS" }
              : { stage: "COMPLETED", completedAt: paymentAt }
            : {}),
        },
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to reprocess Stripe payment:", error);
    return NextResponse.json(
      { error: "Failed to record payment", details: msg },
      { status: 500 }
    );
  }

  // Send receipt email (non-fatal)
  let recipientEmail = job.customer?.email?.trim() || null;
  if (!recipientEmail && paymentIntent.payment_method) {
    try {
      const pm =
        typeof paymentIntent.payment_method === "string"
          ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
          : (paymentIntent.payment_method as Stripe.PaymentMethod);
      recipientEmail = pm.billing_details?.email?.trim() || null;
    } catch {
      // ignore
    }
  }

  if (recipientEmail) {
    const jobForEmail = {
      id: job.id,
      bikeMake: job.bikeMake,
      bikeModel: job.bikeModel,
      customer: job.customer
        ? {
            firstName: job.customer.firstName,
            lastName: job.customer.lastName,
            email: recipientEmail,
          }
        : { firstName: "", lastName: null, email: recipientEmail },
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
    const result = await sendPaymentReceiptEmail(jobForEmail, paymentIntent.amount / 100);
    if (!result.ok) {
      console.error("Receipt email failed after reprocess:", result.error);
    }
  }

  return NextResponse.json({ success: true, message: "Payment recorded successfully" });
}
