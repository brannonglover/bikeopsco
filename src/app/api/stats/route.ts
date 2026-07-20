import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

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

function inRange(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function parseAmount(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isSucceeded(status: unknown): boolean {
  return String(status ?? "").toLowerCase() === "succeeded";
}

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [ys, ms] = key.split("-");
  const d = new Date(Date.UTC(Number(ys), Number(ms) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Last `count` calendar months ending at the current UTC month (oldest → newest). */
function lastNMonthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1));
    keys.push(monthKey(dt));
  }
  return keys;
}

type Period = "day" | "week" | "month" | "year";

async function getAuthorizedShopId(request: NextRequest): Promise<string | null> {
  const token = await getToken({ req: request });
  if (!token?.shopId || typeof token.shopId !== "string") return null;

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop || shop.id !== token.shopId) return null;

  return shop.id;
}

function addPaymentToPeriods(
  ranges: ReturnType<typeof getDateRanges>,
  date: Date,
  amount: number,
  target: Record<Period, number>
) {
  for (const period of ["day", "week", "month", "year"] as Period[]) {
    const { start, end } = ranges[period];
    if (inRange(date, start, end)) {
      target[period] += amount;
    }
  }
}

function emptyPeriods(): Record<Period, number> {
  return { day: 0, week: 0, month: 0, year: 0 };
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60 * 24);
}

export async function GET(request: NextRequest) {
  try {
    const shopId = await getAuthorizedShopId(request);
    if (!shopId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ranges = getDateRanges();
    const now = new Date();
    const y = now.getUTCFullYear();
    const lastYearStart = new Date(Date.UTC(y - 1, 0, 1, 0, 0, 0));
    const lastYearEnd = new Date(Date.UTC(y, 0, 1, 0, 0, 0) - 1);
    const monthKeys = lastNMonthKeys(12, now);
    const seriesStart = new Date(
      Date.UTC(
        Number(monthKeys[0].slice(0, 4)),
        Number(monthKeys[0].slice(5, 7)) - 1,
        1
      )
    );

    const [paymentRows, importedRows] = await Promise.all([
      prisma.payment.findMany({
        where: { shopId },
        include: {
          job: {
            include: {
              jobBikes: { where: { shopId }, select: { id: true } },
            },
          },
        },
      }),
      (async () => {
        try {
          return await prisma.importedRevenue.findMany({ where: { shopId } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
            return [];
          }
          throw e;
        }
      })(),
    ]);

    const succeeded = paymentRows.filter((p) => isSucceeded(p.status));

    const bikesByPeriod = emptyPeriods();
    const shopRevenueByPeriod = emptyPeriods();
    const stripeRevenueByPeriod = emptyPeriods();
    const cashRevenueByPeriod = emptyPeriods();
    const importedRevenueByPeriod = emptyPeriods();
    let lastYearShopRevenue = 0;
    let lastYearStripeRevenue = 0;
    let lastYearCashRevenue = 0;
    let lastYearImportedRevenue = 0;

    const monthlyShopRevenue = new Map<string, number>();
    const monthlyImportedRevenue = new Map<string, number>();
    for (const key of monthKeys) {
      monthlyShopRevenue.set(key, 0);
      monthlyImportedRevenue.set(key, 0);
    }

    // First succeeded payment per job (for bike + turnaround + retention bucketing)
    const firstPaymentByJob = new Map<
      string,
      {
        paidAt: Date;
        customerId: string | null;
        bikeCount: number;
        receivedAt: Date | null;
        createdAt: Date;
        completedAt: Date | null;
      }
    >();

    for (const pay of succeeded) {
      const amt = parseAmount(pay.amount);
      const payDate = pay.createdAt;
      addPaymentToPeriods(ranges, payDate, amt, shopRevenueByPeriod);
      if (pay.stripePaymentIntentId) {
        addPaymentToPeriods(ranges, payDate, amt, stripeRevenueByPeriod);
      } else if (pay.paymentMethod?.toLowerCase() === "cash") {
        addPaymentToPeriods(ranges, payDate, amt, cashRevenueByPeriod);
      }
      if (inRange(payDate, lastYearStart, lastYearEnd)) {
        lastYearShopRevenue += amt;
        if (pay.stripePaymentIntentId) {
          lastYearStripeRevenue += amt;
        } else if (pay.paymentMethod?.toLowerCase() === "cash") {
          lastYearCashRevenue += amt;
        }
      }

      const mk = monthKey(payDate);
      if (monthlyShopRevenue.has(mk)) {
        monthlyShopRevenue.set(mk, (monthlyShopRevenue.get(mk) ?? 0) + amt);
      }

      const existing = firstPaymentByJob.get(pay.jobId);
      if (!existing || payDate < existing.paidAt) {
        const bikeCount = Math.max(1, pay.job.jobBikes.length);
        firstPaymentByJob.set(pay.jobId, {
          paidAt: payDate,
          customerId: pay.job.customerId,
          bikeCount,
          receivedAt: pay.job.receivedAt,
          createdAt: pay.job.createdAt,
          completedAt: pay.job.completedAt,
        });
      }
    }

    for (const jobInfo of firstPaymentByJob.values()) {
      for (const period of ["day", "week", "month", "year"] as Period[]) {
        const { start, end } = ranges[period];
        if (inRange(jobInfo.paidAt, start, end)) {
          bikesByPeriod[period] += jobInfo.bikeCount;
        }
      }
    }

    for (const row of importedRows) {
      const amt = parseAmount(row.amount);
      for (const period of ["day", "week", "month", "year"] as Period[]) {
        const { start, end } = ranges[period];
        if (inRange(row.occurredAt, start, end)) {
          importedRevenueByPeriod[period] += amt;
        }
      }
      if (inRange(row.occurredAt, lastYearStart, lastYearEnd)) {
        lastYearImportedRevenue += amt;
      }
      const mk = monthKey(row.occurredAt);
      if (monthlyImportedRevenue.has(mk)) {
        monthlyImportedRevenue.set(
          mk,
          (monthlyImportedRevenue.get(mk) ?? 0) + amt
        );
      }
    }

    const revenueByPeriod: Record<Period, number> = {
      day: shopRevenueByPeriod.day + importedRevenueByPeriod.day,
      week: shopRevenueByPeriod.week + importedRevenueByPeriod.week,
      month: shopRevenueByPeriod.month + importedRevenueByPeriod.month,
      year: shopRevenueByPeriod.year + importedRevenueByPeriod.year,
    };

    // Monthly revenue + MoM change (includes one prior month for first delta)
    const priorMonthKey = (() => {
      const first = monthKeys[0];
      const dt = new Date(
        Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 2, 1)
      );
      return monthKey(dt);
    })();
    let priorMonthRevenue = 0;
    for (const pay of succeeded) {
      if (monthKey(pay.createdAt) === priorMonthKey) {
        priorMonthRevenue += parseAmount(pay.amount);
      }
    }
    for (const row of importedRows) {
      if (monthKey(row.occurredAt) === priorMonthKey) {
        priorMonthRevenue += parseAmount(row.amount);
      }
    }

    const monthlyRevenue = monthKeys.map((key, i) => {
      const revenue =
        (monthlyShopRevenue.get(key) ?? 0) + (monthlyImportedRevenue.get(key) ?? 0);
      const previous =
        i === 0
          ? priorMonthRevenue
          : (monthlyShopRevenue.get(monthKeys[i - 1]) ?? 0) +
            (monthlyImportedRevenue.get(monthKeys[i - 1]) ?? 0);
      let changePercent: number | null = null;
      let changeDirection: "up" | "down" | "flat" | null = null;
      if (previous > 0) {
        changePercent = Math.round(((revenue - previous) / previous) * 1000) / 10;
        changeDirection =
          changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";
      } else if (revenue > 0 && previous === 0) {
        changePercent = null;
        changeDirection = "up";
      } else if (revenue === 0 && previous === 0) {
        changePercent = 0;
        changeDirection = "flat";
      }
      return {
        month: key,
        label: monthLabel(key),
        revenue,
        previousRevenue: previous,
        changePercent,
        changeDirection,
      };
    });

    // Average turnaround by paid month (received/created → completed or paid)
    const turnaroundBuckets = new Map<string, { totalDays: number; count: number }>();
    for (const key of monthKeys) {
      turnaroundBuckets.set(key, { totalDays: 0, count: 0 });
    }
    for (const jobInfo of firstPaymentByJob.values()) {
      const mk = monthKey(jobInfo.paidAt);
      const bucket = turnaroundBuckets.get(mk);
      if (!bucket) continue;
      const start = jobInfo.receivedAt ?? jobInfo.createdAt;
      const end = jobInfo.completedAt ?? jobInfo.paidAt;
      const days = daysBetween(start, end);
      bucket.totalDays += days;
      bucket.count += 1;
    }
    const turnaround = monthKeys.map((key) => {
      const bucket = turnaroundBuckets.get(key)!;
      return {
        month: key,
        label: monthLabel(key),
        avgDays:
          bucket.count > 0
            ? Math.round((bucket.totalDays / bucket.count) * 10) / 10
            : null,
        sampleSize: bucket.count,
      };
    });

    // Customer retention: new vs returning paying customers per month
    const firstPaidAtByCustomer = new Map<string, Date>();
    for (const jobInfo of firstPaymentByJob.values()) {
      if (!jobInfo.customerId) continue;
      const prev = firstPaidAtByCustomer.get(jobInfo.customerId);
      if (!prev || jobInfo.paidAt < prev) {
        firstPaidAtByCustomer.set(jobInfo.customerId, jobInfo.paidAt);
      }
    }

    const customersPaidInMonth = new Map<string, Set<string>>();
    for (const key of monthKeys) {
      customersPaidInMonth.set(key, new Set());
    }
    for (const jobInfo of firstPaymentByJob.values()) {
      if (!jobInfo.customerId) continue;
      if (jobInfo.paidAt < seriesStart) continue;
      const mk = monthKey(jobInfo.paidAt);
      customersPaidInMonth.get(mk)?.add(jobInfo.customerId);
    }

    const retention = monthKeys.map((key) => {
      const customers = customersPaidInMonth.get(key) ?? new Set();
      let newCustomers = 0;
      let returningCustomers = 0;
      for (const customerId of customers) {
        const first = firstPaidAtByCustomer.get(customerId);
        if (!first) continue;
        if (monthKey(first) === key) {
          newCustomers += 1;
        } else {
          returningCustomers += 1;
        }
      }
      const total = newCustomers + returningCustomers;
      return {
        month: key,
        label: monthLabel(key),
        newCustomers,
        returningCustomers,
        retentionRate:
          total > 0
            ? Math.round((returningCustomers / total) * 1000) / 10
            : 0,
      };
    });

    const paidJobIds = [...firstPaymentByJob.keys()];
    const jobServicesWithService =
      paidJobIds.length === 0
        ? []
        : await prisma.jobService.findMany({
            where: {
              shopId,
              jobId: { in: paidJobIds },
            },
            include: { service: true },
          });

    const serviceMap = new Map<string, { name: string; count: number; revenue: number }>();
    for (const js of jobServicesWithService) {
      const name = js.service?.name ?? js.customServiceName ?? "Custom service";
      if (!serviceMap.has(name)) {
        serviceMap.set(name, { name, count: 0, revenue: 0 });
      }
      const entry = serviceMap.get(name)!;
      const p = parseAmount(js.unitPrice);
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
      monthlyRevenue,
      turnaround,
      retention,
    });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
