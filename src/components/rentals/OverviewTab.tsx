"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  OverviewSkeleton,
  SectionCard,
  StatusBadge,
  type RentalReservationRow,
} from "@/components/rentals/shared";
import {
  formatDateRange,
  initials,
  RENTAL_CATEGORY_LABELS,
  type RentalCategory,
  toNumber,
} from "@/lib/rentals/types";

type OverviewData = {
  stats: {
    todayRentals: number;
    todayActive: number;
    todayPickups: number;
    bikesAvailable: number;
    bikesTotal: number;
    upcomingCount: number;
    monthRevenue: number;
    revenueChangePct: number;
  };
  fleetAvailability: { category: RentalCategory; available: number; total: number }[];
  upcomingReservations: RentalReservationRow[];
  activities: { id: string; message: string; createdAt: string }[];
};

function StatCard({
  label,
  value,
  hint,
  icon,
  iconBg,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
            {value}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function formatActivityTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday.getTime() - 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d >= startToday) return `Today, ${time}`;
  if (d >= startYesterday) return `Yesterday, ${time}`;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OverviewTab({
  onNavigate,
  onNewReservation,
  refreshKey = 0,
}: {
  onNavigate: (tab: "reservations" | "fleet" | "rates" | "addons") => void;
  onNewReservation: () => void;
  refreshKey?: number;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/rentals/overview")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return;
        setData({
          ...json,
          stats: {
            ...json.stats,
            monthRevenue: toNumber(json.stats.monthRevenue),
          },
          upcomingReservations: (json.upcomingReservations ?? []).map(
            (r: RentalReservationRow & { totalPrice?: unknown }) => ({
              ...r,
              totalPrice: toNumber(r.totalPrice),
              unitPrice: toNumber(r.unitPrice),
            })
          ),
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading && !data) {
    return <OverviewSkeleton />;
  }

  const stats = data?.stats ?? {
    todayRentals: 0,
    todayActive: 0,
    todayPickups: 0,
    bikesAvailable: 0,
    bikesTotal: 0,
    upcomingCount: 0,
    monthRevenue: 0,
    revenueChangePct: 0,
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's Rentals"
          value={stats.todayRentals}
          hint={`${stats.todayActive} active, ${stats.todayPickups} pickup`}
          iconBg="bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          label="Bikes Available"
          value={stats.bikesAvailable}
          hint={`of ${stats.bikesTotal} total`}
          iconBg="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Upcoming"
          value={stats.upcomingCount}
          hint="Next 7 days"
          iconBg="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Revenue (Month)"
          value={`$${stats.monthRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          hint={`${stats.revenueChangePct >= 0 ? "+" : ""}${stats.revenueChangePct}% from last month`}
          iconBg="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Upcoming Reservations"
          action={
            <button
              type="button"
              onClick={() => onNavigate("reservations")}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              View all
            </button>
          }
        >
          {(data?.upcomingReservations?.length ?? 0) === 0 ? (
            <EmptyState message="No upcoming reservations yet." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {data!.upcomingReservations.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                    {initials(r.customerName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {r.customerName}
                      </p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                      {r.rentalBike
                        ? `${r.rentalBike.make} ${r.rentalBike.model}`
                        : "Bike"}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {formatDateRange(r.startDate, r.endDate)}
                    </p>
                    <p className="text-xs font-medium text-slate-500">
                      {r.days} day{r.days === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.pickupTime
                        ? `${r.pickupTime} Pickup`
                        : r.status === "REQUESTED"
                          ? "Awaiting approval"
                          : "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Fleet Availability"
          action={
            <button
              type="button"
              onClick={() => onNavigate("fleet")}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              View fleet
            </button>
          }
        >
          {(data?.fleetAvailability?.length ?? 0) === 0 ? (
            <EmptyState message="Add bikes to your fleet to see availability." />
          ) : (
            <ul className="space-y-4">
              {data!.fleetAvailability.map((row) => {
                const pct = row.total > 0 ? Math.round((row.available / row.total) * 100) : 0;
                return (
                  <li key={row.category}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {RENTAL_CATEGORY_LABELS[row.category]}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {row.available} available / {row.total} total
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Rental Activity"
          action={
            <button
              type="button"
              onClick={() => onNavigate("reservations")}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              View all
            </button>
          }
        >
          {(data?.activities?.length ?? 0) === 0 ? (
            <EmptyState message="Activity will appear as reservations are created." />
          ) : (
            <ul className="space-y-3">
              {data!.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-slate-800 dark:text-slate-200">{a.message}</p>
                    <p className="text-xs text-slate-500">{formatActivityTime(a.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Quick Actions">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "New Reservation",
                desc: "Create a new rental booking.",
                onClick: onNewReservation,
              },
              {
                title: "Rental Rates",
                desc: "Set pricing and duration rates.",
                onClick: () => onNavigate("rates"),
              },
              {
                title: "Manage Fleet",
                desc: "Add or update rental bikes.",
                onClick: () => onNavigate("fleet"),
              },
              {
                title: "Add-ons",
                desc: "Helmets, locks, and more.",
                onClick: () => onNavigate("addons"),
              },
            ].map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={action.onClick}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-slate-600 dark:bg-slate-800/60 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
              >
                <p className="font-semibold text-slate-900 dark:text-slate-100">{action.title}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{action.desc}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
