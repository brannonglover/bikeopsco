"use client";

import { useState, useEffect } from "react";
import { Price } from "@/components/ui/Price";

interface Stats {
  bikes: { day: number; week: number; month: number; year: number };
  revenue: { day: number; week: number; month: number; year: number };
  topServices: { name: string; count: number; revenue: number }[];
}

const PERIODS = [
  { key: "day" as const, label: "Today" },
  { key: "week" as const, label: "This Week" },
  { key: "month" as const, label: "This Month" },
  { key: "year" as const, label: "This Year" },
] as const;

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading stats...</div>
    );
  }

  if (!stats) {
    return (
      <div className="py-12 text-center text-red-600">Failed to load stats.</div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Stats</h1>
      <p className="text-slate-600 mb-8">
        Overview of completed bikes and revenue by time period.
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-10">
        {PERIODS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
              {label}
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.bikes[key]}
                </p>
                <p className="text-sm text-slate-600">bikes completed</p>
              </div>
              <div>
                <Price amount={stats.revenue[key]} variant="total" className="text-xl" />
                <p className="text-sm text-slate-600">revenue</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Top 5 Services
        </h2>
        {stats.topServices.length === 0 ? (
          <p className="text-slate-500 py-6">No completed services yet.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-sm font-semibold text-slate-700">
                    #
                  </th>
                  <th className="px-5 py-3 text-left text-sm font-semibold text-slate-700">
                    Service
                  </th>
                  <th className="px-5 py-3 text-right text-sm font-semibold text-slate-700">
                    Count
                  </th>
                  <th className="px-5 py-3 text-right text-sm font-semibold text-slate-700">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.topServices.map((svc, i) => (
                  <tr
                    key={svc.name}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="px-5 py-3 text-sm text-slate-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {svc.name}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {svc.count}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Price amount={svc.revenue} variant="inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
