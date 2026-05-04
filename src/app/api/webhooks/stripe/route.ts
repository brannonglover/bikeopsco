import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";
import { syncStripeSubscription, toStripeDate } from "@/lib/billing";

async function refreshJobPaymentStatus(jobId: string) {
  const jobWithPayments = await prisma.job.findUnique({
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
    throw new Error(`Job ${jobId} not found while refreshing payment status`);
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

  await prisma.job.update({
    where: { id: jobId },
    data: {
      paymentStatus: paymentSummary.paymentStatus,
    },
  });

  return paymentSummary;
}

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
      const jobRow = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, shopId: true },
      });
      if (!jobRow) {
        console.error(`Job ${jobId} not found for Stripe webhook`);
        return NextResponse.json({ received: true });
      }
      const shopId = jobRow.shopId;

      const existing = await prisma.payment.findUnique({
        where: {
          shopId_stripePaymentIntentId: {
            shopId,
            stripePaymentIntentId: paymentIntent.id,
          },
        },
      });
      if (existing) {
        await refreshJobPaymentStatus(jobId);
        console.log(`Webhook idempotency: payment for ${paymentIntent.id} already recorded, refreshed job payment status.`);
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
            shopId,
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
      await refreshJobPaymentStatus(jobId);

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
          shopId: job.shopId,
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const shopId =
      typeof session.metadata?.shopId === "string" && session.metadata.shopId.trim()
        ? session.metadata.shopId.trim()
        : typeof session.client_reference_id === "string"
          ? session.client_reference_id
          : null;
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

    if (shopId && customerId) {
      await prisma.shop.update({
        where: { id: shopId },
        data: { stripeCustomerId: customerId },
      });
    }

    if (session.mode === "subscription" && session.subscription) {
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncStripeSubscription(subscription);
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.paused" ||
    event.type === "customer.subscription.resumed"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    await syncStripeSubscription(subscription);
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      invoice.parent?.subscription_details?.subscription
        ? typeof invoice.parent.subscription_details.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : invoice.parent.subscription_details.subscription.id
        : null;
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncStripeSubscription(subscription);
    } else if (customerId && event.type === "invoice.payment_failed") {
      await prisma.shop.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          billingStatus: "past_due",
          stripeCurrentPeriodEnd: toStripeDate(invoice.period_end),
          stripeSubscriptionUpdatedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({ received: true });
}
