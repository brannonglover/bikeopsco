import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendJobEmail } from "@/lib/email";

/**
 * Sends reminder emails for upcoming drop-offs/collections and pickups/deliveries.
 *
 * Drop-off/collection reminders go to BOOKED_IN jobs whose dropOffDate is tomorrow or today.
 * Pickup/delivery reminders go to BIKE_READY jobs whose pickupDate is tomorrow or today.
 *
 * Template is chosen based on delivery type (drop-off vs collection) and timing (day-before vs day-of).
 * Each (job, templateSlug) pair is sent at most once, deduped via JobEmail records.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const tomorrowEnd = new Date(todayEnd);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    let sent = 0;

    // --- Drop-off / collection reminders (BOOKED_IN jobs with a dropOffDate) ---
    const dropoffJobs = await prisma.job.findMany({
      where: {
        stage: "BOOKED_IN",
        dropOffDate: { gte: todayStart, lte: tomorrowEnd },
        customer: { email: { not: null } },
      },
      include: { customer: true },
    });

    for (const job of dropoffJobs) {
      const email = job.customer?.email;
      if (!email || !job.dropOffDate) continue;

      const isToday =
        job.dropOffDate >= todayStart && job.dropOffDate <= todayEnd;
      const isCollection = job.deliveryType === "COLLECTION_SERVICE";

      const slug = isCollection
        ? isToday
          ? "collection_reminder_day_of"
          : "collection_reminder_day_before"
        : isToday
          ? "dropoff_reminder_day_of"
          : "dropoff_reminder_day_before";

      const alreadySent = await prisma.jobEmail.findFirst({
        where: { jobId: job.id, templateSlug: slug },
      });
      if (alreadySent) continue;

      const result = await sendJobEmail(slug, email, job);
      if (result.ok) sent++;
    }

    // --- Pickup / delivery reminders (BIKE_READY jobs with a pickupDate) ---
    const pickupJobs = await prisma.job.findMany({
      where: {
        stage: "BIKE_READY",
        pickupDate: { gte: todayStart, lte: tomorrowEnd },
        customer: { email: { not: null } },
      },
      include: { customer: true },
    });

    for (const job of pickupJobs) {
      const email = job.customer?.email;
      if (!email || !job.pickupDate) continue;

      const isToday =
        job.pickupDate >= todayStart && job.pickupDate <= todayEnd;
      const isCollection = job.deliveryType === "COLLECTION_SERVICE";

      const slug = isCollection
        ? isToday
          ? "delivery_reminder_day_of"
          : "delivery_reminder_day_before"
        : isToday
          ? "pickup_reminder_day_of"
          : "pickup_reminder_day_before";

      const alreadySent = await prisma.jobEmail.findFirst({
        where: { jobId: job.id, templateSlug: slug },
      });
      if (alreadySent) continue;

      const result = await sendJobEmail(slug, email, job);
      if (result.ok) sent++;
    }

    return NextResponse.json({
      sent,
      checked: {
        dropoff: dropoffJobs.length,
        pickup: pickupJobs.length,
      },
    });
  } catch (error) {
    console.error("Cron send-appointment-reminders error:", error);
    return NextResponse.json(
      { error: "Failed to send appointment reminders" },
      { status: 500 }
    );
  }
}
