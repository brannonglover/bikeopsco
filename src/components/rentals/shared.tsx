"use client";

import type { RentalCategory, RentalReservationStatus } from "@/lib/rentals/types";
import { RENTAL_STATUS_LABELS } from "@/lib/rentals/types";

export function StatusBadge({ status }: { status: RentalReservationStatus }) {
  const styles: Record<RentalReservationStatus, string> = {
    CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    SCHEDULED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    REQUESTED: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200",
    ACTIVE: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
    COMPLETED: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
    CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {RENTAL_STATUS_LABELS[status]}
    </span>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/40 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{message}</p>
  );
}

function SkeletonPulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading rentals overview">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <SkeletonPulse className="h-3.5 w-24" />
                <SkeletonPulse className="h-8 w-16" />
                <SkeletonPulse className="h-3 w-28" />
              </div>
              <SkeletonPulse className="h-10 w-10 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
          >
            <SkeletonPulse className="mb-4 h-4 w-40" />
            <div className="space-y-4">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <SkeletonPulse className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <SkeletonPulse className="h-3.5 w-2/3" />
                    <SkeletonPulse className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
          >
            <SkeletonPulse className="mb-4 h-4 w-32" />
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, j) => (
                <SkeletonPulse key={j} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-700/60">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-slate-900/20">
            <SkeletonPulse className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonPulse className="h-3.5 w-1/3" />
              <SkeletonPulse className="h-3 w-1/2" />
            </div>
            <SkeletonPulse className="hidden h-6 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex gap-4">
          {Array.from({ length: cols }, (_, i) => (
            <SkeletonPulse key={i} className="h-3 w-16" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-4 bg-white px-4 py-3.5 dark:bg-slate-900/20">
            {Array.from({ length: cols }, (_, j) => (
              <SkeletonPulse
                key={j}
                className={`h-3.5 ${j === 0 ? "w-36" : j === cols - 1 ? "ml-auto w-20" : "w-20"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-4 w-28" />
              <SkeletonPulse className="h-3 w-20" />
            </div>
            <SkeletonPulse className="h-7 w-16 rounded-lg" />
          </div>
          <div className="mt-4 flex justify-between">
            <SkeletonPulse className="h-3 w-14" />
            <SkeletonPulse className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export type RentalBikeRow = {
  id: string;
  make: string;
  model: string;
  category: RentalCategory;
  size: string | null;
  description: string | null;
  imageUrl: string | null;
  quantity: number;
  isActive: boolean;
};

export type RentalRateRow = {
  id: string;
  name: string;
  days: number;
  price: number;
  category: RentalCategory | null;
  isActive: boolean;
};

export type RentalAddonRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stockQuantity: number;
  isActive: boolean;
};

export type RentalReservationRow = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerId: string | null;
  rentalBikeId: string;
  startDate: string;
  endDate: string;
  days: number;
  unitPrice: number;
  totalPrice: number;
  status: RentalReservationStatus;
  pickupTime: string | null;
  notes: string | null;
  rentalBike?: { id: string; make: string; model: string; category: RentalCategory };
};
