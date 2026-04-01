"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Job, Stage } from "@/lib/types";
import { getJobBikeDisplayTitle, getDisplayPartsForJobBikeRow } from "@/lib/job-display";

const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked in",
  RECEIVED: "Received",
  WORKING_ON: "Working on",
  WAITING_ON_PARTS: "Waiting on parts",
  BIKE_READY: "Bike ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Stages the PATCH API accepts (excludes CANCELLED — needs reason via reject flow). */
const PATCHABLE_STAGES: Stage[] = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

function stageOptionsForJob(job: Job): Stage[] {
  if (job.stage === "PENDING_APPROVAL") {
    return ["PENDING_APPROVAL", ...PATCHABLE_STAGES];
  }
  return PATCHABLE_STAGES;
}

function formatDate(d: Date | string | null) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatDateFull(d: Date | string | null) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function JobCardContent({
  job,
  onAccept,
  onReject,
  showMobileStageSelect,
  onStageChange,
}: {
  job: Job;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
  /** On narrow viewports, show a status control instead of relying on drag between columns. */
  showMobileStageSelect?: boolean;
  onStageChange?: (stage: Stage) => void;
}) {
  const address =
    job.deliveryType === "COLLECTION_SERVICE"
      ? job.collectionAddress || job.customer?.address
      : job.customer?.address;
  const mapsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-soft min-w-0 w-full">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
              job.deliveryType === "COLLECTION_SERVICE"
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}
          </span>
          {job.paymentStatus === "PAID" && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800">
              Paid
            </span>
          )}
        </div>
        {job.dropOffDate && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800" title="Drop-off date">
            {formatDateFull(job.dropOffDate)}
          </span>
        )}
      </div>
      <h3 className="font-semibold text-slate-900">
        {getJobBikeDisplayTitle(job)}
      </h3>
      {job.workingOnJobBikeId && (() => {
        const activeBike = (job.jobBikes ?? []).find((b) => b.id === job.workingOnJobBikeId);
        if (!activeBike) return null;
        const dp = getDisplayPartsForJobBikeRow(job, activeBike);
        const bikeName = dp.nickname?.trim() || `${dp.make} ${dp.model}`;
        return (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 mt-0.5">
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Working on {bikeName}
          </p>
        );
      })()}
      {job.customer && (
        <p className="text-sm text-slate-700 font-medium mt-1.5" title={`${job.customer.firstName}${job.customer.lastName ? ` ${job.customer.lastName}` : ""}`}>
          {job.customer.lastName
            ? `${job.customer.firstName} ${job.customer.lastName}`
            : job.customer.firstName}
        </p>
      )}
      {(job.pickupDate || (!job.dropOffDate && job.createdAt)) && (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {job.pickupDate && <p>Pickup: {formatDate(job.pickupDate)}</p>}
          {!job.dropOffDate && job.createdAt && (
            <p>Added: {formatDate(job.createdAt)}</p>
          )}
        </div>
      )}
      {job.customerNotes && (
        <p className="mt-2 text-xs text-slate-600 italic line-clamp-2" title={job.customerNotes}>
          {job.customerNotes}
        </p>
      )}
      {address && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-600 mb-1 truncate" title={address}>
            {address}
          </p>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold pointer-events-auto"
            >
              <span>Directions</span>
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      )}
      {onAccept && onReject && job.stage === "PENDING_APPROVAL" && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAccept(job.id);
            }}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReject(job);
            }}
            className="flex-1 rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-200 transition-colors"
          >
            Reject
          </button>
        </div>
      )}
      {showMobileStageSelect && onStageChange && (
        <div
          className="mt-3 pt-3 border-t border-slate-100 md:hidden"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label
            htmlFor={`job-stage-${job.id}`}
            className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5"
          >
            Status
          </label>
          <select
            id={`job-stage-${job.id}`}
            value={job.stage}
            onChange={(e) => onStageChange(e.target.value as Stage)}
            aria-label="Change job status"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 touch-manipulation min-h-[44px]"
          >
            {stageOptionsForJob(job).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

interface JobCardProps {
  job: Job;
  onJobClick?: (job: Job) => void;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
  /** When true, card is not draggable (e.g. mobile — use in-card status instead). */
  dragDisabled?: boolean;
  showMobileStageSelect?: boolean;
  onStageChange?: (stage: Stage) => void;
}

export function JobCard({
  job,
  onJobClick,
  onAccept,
  onReject,
  dragDisabled,
  showMobileStageSelect,
  onStageChange,
}: JobCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: job.id,
    disabled: dragDisabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={
        isDragging
          ? undefined
          : {
              transform: CSS.Transform.toString(transform),
              transition,
            }
      }
      {...attributes}
      {...(dragDisabled ? {} : listeners)}
      onClick={() => onJobClick?.(job)}
      role={onJobClick ? "button" : undefined}
      tabIndex={onJobClick ? 0 : undefined}
      onKeyDown={
        onJobClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onJobClick(job);
              }
            }
          : undefined
      }
      className={`
        min-w-0 w-full
        ${dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
        ${isDragging ? "opacity-40" : ""}
      `}
    >
      {isDragging ? (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 min-h-[120px]" />
      ) : (
        <JobCardContent
          job={job}
          onAccept={onAccept}
          onReject={onReject}
          showMobileStageSelect={showMobileStageSelect}
          onStageChange={onStageChange}
        />
      )}
    </div>
  );
}
