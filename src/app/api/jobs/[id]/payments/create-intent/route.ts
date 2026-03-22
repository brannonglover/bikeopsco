import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStripe, toCents } from "@/lib/stripe";
import { z } from "zod";

const bodySchema = z.object({
  mode: z.enum(["online", "in_person"]).optional().default("online"),
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
      include: { jobServices: { include: { service: true } } },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.paymentStatus === "PAID") {
      return NextResponse.json(
        { error: "Job is already paid" },
        { status: 400 }
      );
    }

    const total = job.jobServices.reduce((sum, js) => {
      const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      return sum + price * (js.quantity || 1);
    }, 0);

    if (total <= 0) {
      return NextResponse.json(
        { error: "Job has no services or total is zero" },
        { status: 400 }
      );
    }

    const amountInCents = toCents(total);

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        jobId,
        mode,
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
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
