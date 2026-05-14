import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeAmountWithSurcharge, getStripe, toCents } from "@/lib/stripe";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";
import { z } from "zod";

const bodySchema = z.object({
  mode: z.enum(["online", "in_person", "terminal"]).optional().default("online"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: jobId } = params;
    const body = await request.json().catch(() => ({}));
    const { mode } = bodySchema.parse(body);

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        shop: { select: { id: true, name: true, subdomain: true } },
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        jobBikes: { select: { make: true, model: true } },
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

    if (subtotal <= 0) {
      return NextResponse.json(
        { error: "Job has no services, products, or total is zero" },
        { status: 400 }
      );
    }

    const PAYABLE_STAGES = ["RECEIVED", "WORKING_ON", "WAITING_ON_CUSTOMER", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED"];
    if (mode === "online" && !PAYABLE_STAGES.includes(job.stage)) {
      return NextResponse.json(
        { error: "Payment is not available until the booking has been confirmed and the bike received" },
        { status: 400 }
      );
    }

    const totalPaid = computeTotalPaid(job.payments);
    const paymentSummary = getJobPaymentSummary({
      currentStatus: job.paymentStatus,
      subtotal,
      totalPaid,
    });

    if (paymentSummary.isPaidInFull || paymentSummary.remaining <= 0) {
      return NextResponse.json(
        { error: "Job is already paid" },
        { status: 400 }
      );
    }

    const amountToCharge = computeAmountWithSurcharge(paymentSummary.remaining, mode);
    const amountInCents = toCents(amountToCharge);

    const customerName = [job.customer?.firstName, job.customer?.lastName]
      .filter(Boolean)
      .join(" ");
    const bikesSummary = job.jobBikes
      .map((b) => [b.make, b.model].filter(Boolean).join(" "))
      .join(", ");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
    const metadata: Record<string, string> = {
      jobId,
      mode,
      shopId: job.shop.id,
      shopName: job.shop.name,
      shopSubdomain: job.shop.subdomain,
      ...(job.customer && { customerId: job.customer.id }),
      ...(customerName && { customerName }),
      ...(job.customer?.email && { customerEmail: job.customer.email }),
      ...(job.customer?.phone && { customerPhone: job.customer.phone }),
      ...(bikesSummary && { bikes: bikesSummary.slice(0, 500) }),
      ...(appUrl && { jobUrl: `${appUrl}/jobs?job=${jobId}` }),
    };

    const description = [
      customerName || "Walk-in",
      bikesSummary ? `— ${bikesSummary}` : "",
      `(${job.shop.name})`,
    ]
      .filter(Boolean)
      .join(" ");

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create(
      mode === "terminal"
        ? {
            amount: amountInCents,
            currency: "usd",
            payment_method_types: ["card_present"],
            capture_method: "automatic",
            description,
            metadata,
          }
        : {
            amount: amountInCents,
            currency: "usd",
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
            description,
            metadata,
          }
    );

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      amount: amountToCharge,
      subtotal: paymentSummary.remaining,
      totalPaid: paymentSummary.totalPaid,
      originalSubtotal: paymentSummary.subtotal,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/jobs/[id]/payments/create-intent error:", error);

    // Surface actionable errors for debugging (Stripe + env)
    const err = error as { type?: string; message?: string; code?: string };
    if (err.message?.includes("STRIPE_SECRET_KEY")) {
      return NextResponse.json(
        { error: "Stripe is not configured. Add STRIPE_SECRET_KEY in Vercel Environment Variables, then redeploy." },
        { status: 500 }
      );
    }
    if (err.type?.startsWith("Stripe") && typeof err.message === "string") {
      return NextResponse.json(
        { error: `Stripe: ${err.message}` },
        { status: 500 }
      );
    }
    if (err.message) {
      return NextResponse.json({ error: String(err.message) }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Failed to create payment intent" },
      { status: 500 }
    );
  }
}
