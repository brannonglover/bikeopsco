import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const jobId = paymentIntent.metadata?.jobId;
    if (!jobId) {
      console.error("Payment intent missing jobId in metadata");
      return NextResponse.json({ received: true });
    }

    try {
      const existing = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntent.id },
      });
      if (existing) {
        console.log(`Webhook idempotency: payment for ${paymentIntent.id} already recorded, skipping.`);
        return NextResponse.json({ received: true });
      }

      await prisma.$transaction(async (tx) => {
        const paymentAt = new Date(event.created * 1000);
        const amount = (paymentIntent.amount / 100).toFixed(2);
        const mode =
          typeof paymentIntent.metadata?.mode === "string" && paymentIntent.metadata.mode.trim()
            ? paymentIntent.metadata.mode.trim()
            : null;
        await tx.payment.create({
          data: {
            jobId,
            stripePaymentIntentId: paymentIntent.id,
            amount,
            currency: paymentIntent.currency ?? "usd",
            status: paymentIntent.status,
            createdAt: paymentAt,
            paymentMethod: mode ??
              (paymentIntent.payment_method
                ? typeof paymentIntent.payment_method === "string"
                  ? paymentIntent.payment_method
                  : (paymentIntent.payment_method as Stripe.PaymentMethod).type
                : null),
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
          throw new Error(`Job ${jobId} not found while applying Stripe payment`);
        }

        const subtotal = computeJobSubtotal({
          jobServices: jobWithPayments.jobServices,
          jobProducts: jobWithPayments.jobProducts,
        });
        const totalPaid = computeTotalPaid(jobWithPayments.payments);
        const paymentSummary = getJobPaymentSummary({
          currentStatus: jobWithPayments.paymentStatus,
          subtotal,
          totalPaid,
        });

        await tx.job.update({
          where: { id: jobId },
          data: {
            paymentStatus: paymentSummary.paymentStatus,
          },
        });
      });

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
          customer: true,
          jobServices: { include: { service: true } },
          jobProducts: { include: { product: true } },
        },
      });

      let recipientEmail = job?.customer?.email?.trim() || null;
      if (!recipientEmail && paymentIntent.payment_method) {
        try {
          const pm =
            typeof paymentIntent.payment_method === "string"
              ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
              : paymentIntent.payment_method;
          recipientEmail = (pm as Stripe.PaymentMethod).billing_details?.email?.trim() || null;
        } catch (e) {
          console.warn("Could not retrieve payment method for email:", e);
        }
      }

      if (job && recipientEmail) {
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
        const amountPaid = paymentIntent.amount / 100;
        const result = await sendPaymentReceiptEmail(jobForEmail, amountPaid);
        if (!result.ok) {
          console.error("Payment receipt email failed:", result.error);
        } else {
          console.log(`Payment receipt sent to ${recipientEmail} for job ${jobId}`);
        }
      } else if (!recipientEmail) {
        console.warn(`No email for payment receipt: job ${jobId} has no customer email and Stripe billing_details has no email. Link a customer with email to the job, or the Payment Element will collect email when configured.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Failed to process payment webhook:", msg, error);
      return NextResponse.json(
        { error: "Failed to process payment", detail: msg },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ received: true });
}
