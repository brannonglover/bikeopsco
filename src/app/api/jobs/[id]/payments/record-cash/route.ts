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
        jobProducts: { include: { product: true } },
      },
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

    const amount =
      job.jobServices.reduce((sum, js) => {
        const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
        return sum + price * (js.quantity || 1);
      }, 0) +
      (job.jobProducts ?? []).reduce((sum, jp) => {
        const price = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
        return sum + price * (jp.quantity || 1);
      }, 0);

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Job has no services, products, or total is zero" },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          jobId,
          amount: amount.toFixed(2),
          currency: "usd",
          status: "succeeded",
          paymentMethod: "cash",
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
        product: { name: jp.product.name },
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
    console.error("POST /api/jobs/[id]/payments/record-cash error:", error);
    return NextResponse.json(
      { error: "Failed to record cash payment" },
      { status: 500 }
    );
  }
}
