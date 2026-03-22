import { NextResponse } from "next/server";
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
      start: utc(y, m, 1, 0, 0, 0),
      end: now,
    },
    year: {
      start: utc(y, 0, 1, 0, 0, 0),
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

export async function GET() {
  try {
    const ranges = getDateRanges();

    const completedJobs = await prisma.job.findMany({
      where: { stage: "COMPLETED" },
      include: {
        jobServices: true,
      },
    });

    type Period = "day" | "week" | "month" | "year";
    const bikesByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };
    const revenueByPeriod: Record<Period, number> = {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
    };

    for (const job of completedJobs) {
      const date = job.completedAt ?? job.updatedAt;
      const revenue = job.jobServices.reduce((sum, js) => {
        const q = js.quantity;
        const p = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
        return sum + q * p;
      }, 0);

      for (const period of ["day", "week", "month", "year"] as Period[]) {
        const { start, end } = ranges[period];
        if (inRange(date, start, end, job.updatedAt)) {
          bikesByPeriod[period]++;
          revenueByPeriod[period] += revenue;
        }
      }
    }

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

    return NextResponse.json({
      bikes: bikesByPeriod,
      revenue: revenueByPeriod,
      topServices,
    });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
