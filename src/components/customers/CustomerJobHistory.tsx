"use client";

import { useCallback, useEffect, useState } from "react";
import { JOBS_REFRESH_EVENT } from "@/lib/jobs-refresh";

type HistoryJobService = {
  id: string;
  customServiceName: string | null;
  quantity: number;
  unitPrice: string;
  service: { name: string } | null;
};

type HistoryJobProduct = {
  id: string;
  quantity: number;
  unitPrice: string;
  product: { name: string };
};

type HistoryJobBike = {
  id: string;
  make: string;
  model: string;
  nickname: string | null;
};

type HistoryJob = {
  id: string;
  stage: string;
  paymentStatus: string;
  dropOffDate: string | null;
  completedAt: string | null;
  createdAt: string;
  bikeMake: string;
  bikeModel: string;
  jobBikes: HistoryJobBike[];
  jobServices: HistoryJobService[];
  jobProducts: HistoryJobProduct[];
  notes: string | null;
  cancellationReason: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked in",
  RECEIVED: "Received",
  WORKING_ON: "Working on it",
  WAITING_ON_CUSTOMER: "Waiting on customer",
  WAITING_ON_PARTS: "Waiting on parts",
  BIKE_READY: "Ready for pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PENDING: "Partially paid",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

function stageBadgeClass(stage: string): string {
  if (stage === "COMPLETED") return "bg-green-100 text-green-700";
  if (stage === "CANCELLED") return "bg-red-100 text-red-600";
  if (stage === "BIKE_READY") return "bg-blue-100 text-blue-700";
  if (stage === "WAITING_ON_CUSTOMER") return "bg-violet-100 text-violet-700";
  return "bg-slate-100 text-slate-600";
}

function paymentBadgeClass(status: string): string {
  if (status === "PAID") return "bg-green-100 text-green-700";
  if (status === "REFUNDED") return "bg-orange-100 text-orange-700";
  if (status === "PENDING") return "bg-yellow-100 text-yellow-700";
  return "bg-slate-100 text-slate-500";
}

function jobTotal(job: HistoryJob): number {
  const serviceTotal = job.jobServices.reduce(
    (sum, s) => sum + s.quantity * parseFloat(s.unitPrice),
    0
  );
  const productTotal = job.jobProducts.reduce(
    (sum, p) => sum + p.quantity * parseFloat(p.unitPrice),
    0
  );
  return serviceTotal + productTotal;
}

function bikeSummary(job: HistoryJob): string {
  if (job.jobBikes.length === 0) return `${job.bikeMake} ${job.bikeModel}`;
  if (job.jobBikes.length === 1) {
    const b = job.jobBikes[0];
    const makeModel = [b.make, b.model].filter(Boolean).join(" ");
    return b.nickname ? `${b.nickname} (${makeModel})` : makeModel;
  }
  return `${job.jobBikes.length} bikes`;
}

function JobHistoryItem({ job }: { job: HistoryJob }) {
  const [expanded, setExpanded] = useState(false);
  const total = jobTotal(job);
  const date = job.dropOffDate ?? job.createdAt;
  const hasLineItems = job.jobServices.length > 0 || job.jobProducts.length > 0;

  return (
    <li className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="text-sm font-medium text-slate-900 truncate">
              {bikeSummary(job)}
            </span>
            <span
              className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${stageBadgeClass(job.stage)}`}
            >
              {STAGE_LABELS[job.stage] ?? job.stage}
            </span>
            {total > 0 && (
              <span
                className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${paymentBadgeClass(job.paymentStatus)}`}
              >
                {PAYMENT_LABELS[job.paymentStatus] ?? job.paymentStatus}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {new Date(date).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            {total > 0 && (
              <span className="text-xs font-medium text-slate-700">
                ${total.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-2 bg-slate-50">
          {hasLineItems ? (
            <div className="space-y-1">
              {job.jobServices.map((s) => (
                <div key={s.id} className="flex justify-between text-sm text-slate-700">
                  <span>
                    {s.service?.name ?? s.customServiceName ?? "Service"}
                    {s.quantity > 1 && (
                      <span className="text-slate-400 ml-1">×{s.quantity}</span>
                    )}
                  </span>
                  <span>${(s.quantity * parseFloat(s.unitPrice)).toFixed(2)}</span>
                </div>
              ))}
              {job.jobProducts.map((p) => (
                <div key={p.id} className="flex justify-between text-sm text-slate-700">
                  <span>
                    {p.product.name}
                    {p.quantity > 1 && (
                      <span className="text-slate-400 ml-1">×{p.quantity}</span>
                    )}
                  </span>
                  <span>${(p.quantity * parseFloat(p.unitPrice)).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold text-slate-900 border-t border-slate-200 pt-1 mt-1">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">No line items recorded</p>
          )}

          {job.notes && (
            <p className="text-xs text-slate-500 whitespace-pre-line border-t border-slate-100 pt-2">
              {job.notes}
            </p>
          )}
          {job.cancellationReason && (
            <p className="text-xs text-red-500 border-t border-slate-100 pt-2">
              Cancelled: {job.cancellationReason}
            </p>
          )}
          {job.completedAt && (
            <p className="text-xs text-slate-400">
              Completed{" "}
              {new Date(job.completedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function CustomerJobHistory({
  customerId,
  excludeJobId,
}: {
  customerId: string;
  /** When set (e.g. from a job card), omit that job so the list is past/other visits only. */
  excludeJobId?: string;
}) {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      fetch(`/api/customers/${customerId}/history`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? (data as HistoryJob[]) : [];
          setJobs(excludeJobId ? list.filter((j) => j.id !== excludeJobId) : list);
        })
        .catch(() => setJobs([]))
        .finally(() => setLoading(false));
    },
    [customerId, excludeJobId]
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const handleJobsRefresh = () => fetchHistory({ silent: true });
    window.addEventListener(JOBS_REFRESH_EVENT, handleJobsRefresh);
    return () => {
      window.removeEventListener(JOBS_REFRESH_EVENT, handleJobsRefresh);
    };
  }, [fetchHistory]);

  if (loading) {
    return <p className="text-slate-500 text-sm py-2">Loading history...</p>;
  }

  if (jobs.length === 0) {
    return (
      <p className="text-slate-500 text-sm py-2">
        {excludeJobId ? "No other jobs on record." : "No jobs on record yet."}
      </p>
    );
  }

  const totalSpend = jobs.reduce((sum, j) => sum + jobTotal(j), 0);

  return (
    <div className="space-y-2">
      {totalSpend > 0 && (
        <p className="text-xs text-slate-500">
          {jobs.length} job{jobs.length !== 1 ? "s" : ""} &middot; ${totalSpend.toFixed(2)} lifetime spend
        </p>
      )}
      {totalSpend === 0 && (
        <p className="text-xs text-slate-500">
          {jobs.length} job{jobs.length !== 1 ? "s" : ""}
        </p>
      )}
      <ul className="space-y-2">
        {jobs.map((job) => (
          <JobHistoryItem key={job.id} job={job} />
        ))}
      </ul>
    </div>
  );
}
