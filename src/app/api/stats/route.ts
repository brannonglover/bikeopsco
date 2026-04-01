import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function getDateRanges() {
  const now = new Date();
  const utc = (y: number, m: number, d: number, h = 0, min = 0, sec = 0) =>
    new Date(Date.UTC(y, m, d, h, min, sec));

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dow = now.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setUTCDate(d + mondayOffset);
  monday.setUTCHours(0, 0, 0, 0);
  const weekStart = monday;

  // Calendar month/year can start after the current week (e.g. April 1 vs week
  // beginning Monday March 30 UTC). Without aligning, jobs in that week but
  // before the 1st count for "this week" but not "this month". Extend month/year
  // backward to weekStart when needed so week ⊆ month ⊆ year.
  const monthCalStart = utc(y, m, 1, 0, 0, 0);
  const yearCalStart = utc(y, 0, 1, 0, 0, 0);
  const monthStart = new Date(
    Math.min(monthCalStart.getTime(), weekStart.getTime())
  );
  const yearStart = new Date(Math.min(yearCalStart.getTime(), weekStart.getTime()));

  return {
    day: {
      start: utc(y, m, d, 0, 0, 0),
      end: now,
    },
    week: {
      start: weekStart,
      end: now,
    },
    month: {
      start: monthStart,
      end: now,
    },
    year: {
      start: yearStart,
      end: now,
    },
  };
}

function inRange(
  date: Date | null,
  start: Date,
  end: Date,
  fallback: Date | null
): boolean {
  const d = date ?? fallback;
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function lineItemRevenue(job: {
  jobServices: { quantity: number; unitPrice: unknown }[];
  jobProducts?: { quantity: number; unitPrice: unknown }[];
}): number {
  const services = job.jobServices.reduce((sum, js) => {
    const q = js.quantity;
    const p = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    return sum + q * p;
  }, 0);
  const products = (job.jobProducts ?? []).reduce((sum, jp) => {
    const q = jp.quantity;
    const p = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
    return sum + q * p;
  }, 0);
  return services + products;
}

type Period = "day" | "week" | "month" | "year";

function addPaymentToPeriods(
  ranges: ReturnType<typeof getDateRanges>,
  date: Date,
  amount: number,
  target: Record<Period, number>
) {
  for (const period of ["day", "week", "month", "year"] as Period[]) {
    const { start, end } = ranges[period];
    if (inRange(date, start, end, date)) {
      target[period] += amount;
    }
  }
}

export async function GET() {
  try {
    const ranges = getDateRanges();
    const now = new Date();
    const y = now.getUTCFullYear();
    const lastYearStart = new Date(Date.UTC(y - 1, 0, 1, 0, 0, 0));
    const lastYearEnd = new Date(Date.UTC(y, 0, 1, 0, 0, 0) - 1);

    const completedJobs = await prisma.job.findMany({
      where: { stage: "COMPLETED" },
      include: {
        jobServices: true,
        jobProducts: true,
        payments: true,
      },
    });

    const bikesByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    const shopRevenueByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    const stripeRevenueByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    const cashRevenueByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    const importedRevenueByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    let lastYearShopRevenue = 0;
    let lastYearStripeRevenue = 0;
    let lastYearCashRevenue = 0;
    let lastYearImportedRevenue = 0;

    for (const job of completedJobs) {
      const date = job.completedAt ?? job.updatedAt;
      for (const period of ["day", "week", "month", "year"] as Period[]) {
        const { start, end } = ranges[period];
        if (inRange(date, start, end, job.updatedAt)) {
          bikesByPeriod[period]++;
        }
      }

      const paymentTotal = job.payments.reduce((sum, p) => {
        const a = typeof p.amount === "string" ? parseFloat(p.amount) : Number(p.amount);
        return sum + a;
      }, 0);

      if (paymentTotal > 0) {
        for (const pay of job.payments) {
          const amt =
            typeof pay.amount === "string" ? parseFloat(pay.amount) : Number(pay.amount);
          const payDate = pay.createdAt;
          addPaymentToPeriods(ranges, payDate, amt, shopRevenueByPeriod);
          if (pay.stripePaymentIntentId) {
            addPaymentToPeriods(ranges, payDate, amt, stripeRevenueByPeriod);
          } else if (pay.paymentMethod?.toLowerCase() === "cash") {
            addPaymentToPeriods(ranges, payDate, amt, cashRevenueByPeriod);
          }
          if (inRange(payDate, lastYearStart, lastYearEnd, payDate)) {
            lastYearShopRevenue += amt;
            if (pay.stripePaymentIntentId) {
              lastYearStripeRevenue += amt;
            } else if (pay.paymentMethod?.toLowerCase() === "cash") {
              lastYearCashRevenue += amt;
            }
          }
        }
      } else {
        const revenue = lineItemRevenue(job);
        for (const period of ["day", "week", "month", "year"] as Period[]) {
          const { start, end } = ranges[period];
          if (inRange(date, start, end, job.updatedAt)) {
            shopRevenueByPeriod[period] += revenue;
          }
        }
        if (inRange(date, lastYearStart, lastYearEnd, job.updatedAt)) {
          lastYearShopRevenue += revenue;
        }
      }
    }

    let importedRows: Awaited<ReturnType<typeof prisma.importedRevenue.findMany>> = [];
    try {
      importedRows = await prisma.importedRevenue.findMany();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
        importedRows = [];
      } else {
        throw e;
      }
    }
    for (const row of importedRows) {
      const amt =
        typeof row.amount === "string" ? parseFloat(row.amount) : Number(row.amount);
      for (const period of ["day", "week", "month", "year"] as Period[]) {
        const { start, end } = ranges[period];
        if (inRange(row.occurredAt, start, end, row.occurredAt)) {
          importedRevenueByPeriod[period] += amt;
        }
      }
      if (inRange(row.occurredAt, lastYearStart, lastYearEnd, row.occurredAt)) {
        lastYearImportedRevenue += amt;
      }
    }

    const revenueByPeriod: Record<Period, number> = {
      day: shopRevenueByPeriod.day + importedRevenueByPeriod.day,
      week: shopRevenueByPeriod.week + importedRevenueByPeriod.week,
      month: shopRevenueByPeriod.month + importedRevenueByPeriod.month,
      year: shopRevenueByPeriod.year + importedRevenueByPeriod.year,
    };

    const jobServicesWithService = await prisma.jobService.findMany({
      where: {
        job: { stage: "COMPLETED" },
      },
      include: { service: true },
    });

    const serviceMap = new Map<string, { name: string; count: number; revenue: number }>();
    for (const js of jobServicesWithService) {
      const name = js.service.name;
      if (!serviceMap.has(name)) {
        serviceMap.set(name, { name, count: 0, revenue: 0 });
      }
      const entry = serviceMap.get(name)!;
      const p = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      entry.count += js.quantity;
      entry.revenue += js.quantity * p;
    }

    const topServices = Array.from(serviceMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastYearRevenue = lastYearShopRevenue + lastYearImportedRevenue;

    return NextResponse.json({
      bikes: bikesByPeriod,
      revenue: revenueByPeriod,
      shopRevenue: shopRevenueByPeriod,
      stripeRevenue: stripeRevenueByPeriod,
      cashRevenue: cashRevenueByPeriod,
      importedRevenue: importedRevenueByPeriod,
      lastYear: {
        calendarYear: y - 1,
        revenue: lastYearRevenue,
        shopRevenue: lastYearShopRevenue,
        stripeRevenue: lastYearStripeRevenue,
        cashRevenue: lastYearCashRevenue,
        importedRevenue: lastYearImportedRevenue,
      },
      topServices,
    });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
