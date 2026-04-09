import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";

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
      await prisma.$transaction(async (tx) => {
        const amount = (paymentIntent.amount / 100).toFixed(2);
        await tx.payment.create({
          data: {
            jobId,
            stripePaymentIntentId: paymentIntent.id,
            amount,
            currency: paymentIntent.currency ?? "usd",
            status: paymentIntent.status,
            paymentMethod: paymentIntent.payment_method
              ? typeof paymentIntent.payment_method === "string"
                ? paymentIntent.payment_method
                : (paymentIntent.payment_method as Stripe.PaymentMethod).type
              : null,
          },
        });

        const jobBikes = await tx.jobBike.findMany({
          where: { jobId },
          select: { waitingOnPartsAt: true, completedAt: true },
        });
        const hasUnresolvedParts = jobBikes.some(
          (b) => b.waitingOnPartsAt !== null && b.completedAt === null
        );

        await tx.job.update({
          where: { id: jobId },
          data: {
            paymentStatus: "PAID",
            ...(hasUnresolvedParts
              ? { stage: "WAITING_ON_PARTS" }
              : { stage: "COMPLETED", completedAt: new Date() }),
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
            product: { name: jp.product.name },
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
      console.error("Failed to process payment webhook:", error);
      return NextResponse.json(
        { error: "Failed to process payment" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ received: true });
}
