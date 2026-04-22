"use client";

import type { Job } from "@/lib/types";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";
import { getJobBikeDisplayTitle } from "@/lib/job-display";

function formatShortDate(d: Date | string | null) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function customerLine(job: Job) {
  if (!job.customer) return "Customer";
  const { firstName, lastName } = job.customer;
  return lastName ? `${firstName} ${lastName}` : firstName;
}

interface MobileJobQueueProps {
  pendingJobs: Job[];
  bookedInJobs: Job[];
  onJobClick: (job: Job) => void;
  onAccept: (jobId: string) => void;
  onReject: (job: Job) => void;
  jobNotifyCustomer?: (jobId: string) => boolean;
  onJobNotifyCustomerChange?: (jobId: string, notify: boolean) => void;
}

export function MobileJobQueue({
  pendingJobs,
  bookedInJobs,
  onJobClick,
  onAccept,
  onReject,
  jobNotifyCustomer,
  onJobNotifyCustomerChange,
}: MobileJobQueueProps) {
  const features = useAppFeatures();
  if (pendingJobs.length === 0 && bookedInJobs.length === 0) {
    return null;
  }

  return (
    <div className="md:hidden space-y-4 flex-shrink-0">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Today&apos;s focus</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Approve bookings and see what&apos;s coming in — swipe below for every stage.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {pendingJobs.length > 0 && (
          <section
            aria-labelledby="mobile-queue-pending-heading"
            className="rounded-2xl border border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-white shadow-soft overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-600 dark:bg-amber-800 text-white">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-sm font-bold"
                aria-hidden
              >
                {pendingJobs.length}
              </span>
              <div>
                <h3 id="mobile-queue-pending-heading" className="text-sm font-bold leading-tight">
                  Pending approval
                </h3>
                <p className="text-[11px] text-amber-100/95 font-medium">Needs a yes or no</p>
              </div>
            </div>
            <ul className="divide-y divide-amber-100/80">
              {pendingJobs.map((job) => (
                <li key={job.id} className="p-3">
                  <button
                    type="button"
                    onClick={() => onJobClick(job)}
                    className="w-full text-left rounded-xl px-1 py-0.5 -mx-1 -my-0.5 active:bg-amber-50/80 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 truncate">{customerLine(job)}</p>
                        <p className="text-sm text-slate-600 truncate">
                          {getJobBikeDisplayTitle(job)}
                        </p>
                      </div>
                      {job.dropOffDate && (
                        <span
                          className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900/80 bg-amber-100 px-2 py-1 rounded-md"
                          title="Drop-off"
                        >
                          {formatShortDate(job.dropOffDate)}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAccept(job.id);
                      }}
                      className="flex-1 min-h-[40px] rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors touch-manipulation"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReject(job);
                      }}
                      className="flex-1 min-h-[40px] rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 hover:bg-red-100 active:bg-red-100 transition-colors touch-manipulation"
                    >
                      Reject
                    </button>
                  </div>
                  {features.notifyCustomerEnabled &&
                    jobNotifyCustomer &&
                    onJobNotifyCustomerChange &&
                    job.customer &&
                    (job.customer.email || job.customer.phone) && (
                      <label className="flex items-start gap-2 mt-2.5 px-0.5 cursor-pointer select-none touch-manipulation">
                        <input
                          type="checkbox"
                          checked={jobNotifyCustomer(job.id)}
                          onChange={(e) =>
                            onJobNotifyCustomerChange(job.id, e.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-[11px] text-slate-600 leading-snug">
                          <span className="font-semibold text-slate-800">Notify customer</span>
                          <span className="block text-slate-500 mt-0.5">
                            Uncheck to skip email and SMS when accepting or rejecting from here.
                          </span>
                        </span>
                      </label>
                    )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {bookedInJobs.length > 0 && (
          <section
            aria-labelledby="mobile-queue-booked-heading"
            className="rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white shadow-soft overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-600 dark:bg-slate-800 text-white">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-sm font-bold"
                aria-hidden
              >
                {bookedInJobs.length}
              </span>
              <div>
                <h3 id="mobile-queue-booked-heading" className="text-sm font-bold leading-tight">
                  Booked in
                </h3>
                <p className="text-[11px] text-slate-200 font-medium">Scheduled / confirmed</p>
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {bookedInJobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => onJobClick(job)}
                    className="w-full text-left p-3.5 rounded-none active:bg-slate-50 transition-colors touch-manipulation min-h-[52px]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 truncate">{customerLine(job)}</p>
                        <p className="text-sm text-slate-600 truncate">
                          {getJobBikeDisplayTitle(job)}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                              job.deliveryType === "COLLECTION_SERVICE"
                                ? "bg-amber-100 text-amber-900"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}
                          </span>
                          {job.paymentStatus === "PAID" ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 whitespace-nowrap">
                              Paid
                            </span>
                          ) : job.paymentStatus === "PENDING" ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 whitespace-nowrap">
                              Partially paid
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {job.dropOffDate && (
                        <span className="flex-shrink-0 text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-md self-start">
                          {formatShortDate(job.dropOffDate)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
