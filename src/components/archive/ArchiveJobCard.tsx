"use client";

import type { Job } from "@/lib/types";
import { getJobBikeDisplayTitle } from "@/lib/job-display";

function customerName(job: Job) {
  if (!job.customer) return null;
  const { firstName, lastName } = job.customer;
  return lastName ? `${firstName} ${lastName}` : firstName;
}

export function ArchiveJobCard({
  job,
  variant,
  footerPrimary,
  onClick,
}: {
  job: Job;
  variant: "completed" | "cancelled";
  footerPrimary: string;
  onClick: () => void;
}) {
  const name = customerName(job);
  const isCancelled = variant === "cancelled";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:shadow-md ${
        isCancelled
          ? "border-red-100 hover:border-red-200"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <span
          className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${
            isCancelled ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {isCancelled ? "Cancelled" : "Completed"}
        </span>
        {isCancelled && (
          <span className="min-w-0 truncate text-[10px] font-medium text-slate-500">
            {job.archivedAt ? "Archived" : "On archive list"}
          </span>
        )}
      </div>

      <h3 className="truncate text-sm font-semibold leading-snug text-slate-900">
        {getJobBikeDisplayTitle(job)}
      </h3>

      {name && (
        <p className="mt-0.5 truncate text-xs font-medium text-slate-600">{name}</p>
      )}

      {job.customerNotes && (
        <p
          className="mt-1 line-clamp-1 text-[11px] italic text-slate-500"
          title={job.customerNotes}
        >
          {job.customerNotes}
        </p>
      )}

      <div
        className={`mt-2 flex min-w-0 items-center justify-between gap-2 border-t pt-2 ${
          isCancelled ? "border-red-50" : "border-slate-100"
        }`}
      >
        <span className="min-w-0 truncate text-[10px] font-medium text-slate-500">
          {footerPrimary}
        </span>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">
          #{job.id.slice(-6)}
        </span>
      </div>
    </button>
  );
}
