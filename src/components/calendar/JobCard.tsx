"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Job, Stage } from "@/lib/types";
import { getJobBikeDisplayTitle, getDisplayPartsForJobBikeRow } from "@/lib/job-display";
import { useUnreadChatCustomerIds } from "@/contexts/StaffChatAttentionContext";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";

const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked in",
  RECEIVED: "Received",
  WORKING_ON: "Working on",
  WAITING_ON_CUSTOMER: "Waiting on customer",
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
  "WAITING_ON_CUSTOMER",
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

export function JobCardContent({
  job,
  onAccept,
  onReject,
  showMobileStageSelect,
  onStageChange,
  variant = "card",
  notifyCustomer = true,
  onNotifyCustomerChange,
}: {
  job: Job;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
  /** On narrow viewports, show a status control instead of relying on drag between columns. */
  showMobileStageSelect?: boolean;
  onStageChange?: (stage: Stage) => void;
  /** "card" renders a bordered card container; "plain" renders without border/background. */
  variant?: "card" | "plain";
  /** When false, board actions skip customer email/SMS for this job. */
  notifyCustomer?: boolean;
  onNotifyCustomerChange?: (notify: boolean) => void;
}) {
  const features = useAppFeatures();
  const unreadChatCustomerIds = useUnreadChatCustomerIds();
  const hasPendingChat = !!job.customerId && unreadChatCustomerIds.has(job.customerId);
  const effectiveNotifyCustomer = features.notifyCustomerEnabled ? notifyCustomer : false;
  const address =
    job.deliveryType === "COLLECTION_SERVICE"
      ? job.collectionAddress || job.customer?.address
      : job.customer?.address;
  const mapsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  const showNotifyToggle =
    features.notifyCustomerEnabled &&
    !!onNotifyCustomerChange &&
    !!job.customer &&
    !!(job.customer.email || job.customer.phone) &&
    job.stage !== "CANCELLED" &&
    job.stage !== "COMPLETED";

  const containerClass =
    variant === "plain"
      ? "min-w-0 w-full"
      : "bg-white rounded-xl border border-slate-200/80 p-4 shadow-soft min-w-0 w-full";

  return (
    <div className={containerClass}>
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
          {job.paymentStatus === "PAID" ? (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 whitespace-nowrap">
              Paid
            </span>
          ) : job.paymentStatus === "PENDING" ? (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 whitespace-nowrap">
              Partially paid
            </span>
          ) : null}
        </div>
      </div>
      <h3 className="font-semibold text-slate-900">
        {getJobBikeDisplayTitle(job)}
      </h3>
      {(() => {
        if (job.stage === "COMPLETED" || job.stage === "CANCELLED") {
          return null;
        }
        const hasWaitingBike = (job.jobBikes ?? []).some(
          (b) =>
            b.waitingOnPartsAt &&
            !b.completedAt &&
            b.id !== job.workingOnJobBikeId
        );
        if (job.stage !== "WAITING_ON_PARTS" && !hasWaitingBike) return null;
        return (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-red-700 mt-0.5">
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
            Waiting on parts
          </p>
        );
      })()}
      {job.workingOnJobBikeId && (() => {
        const activeBike = (job.jobBikes ?? []).find((b) => b.id === job.workingOnJobBikeId);
        if (!activeBike) return null;
        const dp = getDisplayPartsForJobBikeRow(job, activeBike);
        const bikeName = dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ");
        return (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 mt-0.5">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            Working on {bikeName}
          </p>
        );
      })()}
      {hasPendingChat && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 mt-0.5">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Chat waiting
        </p>
      )}
      {job.customer && (
        <p className="text-sm text-slate-700 font-medium mt-1.5" title={`${job.customer.firstName}${job.customer.lastName ? ` ${job.customer.lastName}` : ""}`}>
          {job.customer.lastName
            ? `${job.customer.firstName} ${job.customer.lastName}`
            : job.customer.firstName}
        </p>
      )}
      {(job.dropOffDate || job.pickupDate || (!job.dropOffDate && job.createdAt)) && (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {job.dropOffDate && (
            <p>
              {job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}:{" "}
              {formatDate(job.dropOffDate)}
            </p>
          )}
          {job.pickupDate && (
            <p>
              {job.deliveryType === "COLLECTION_SERVICE" ? "Return" : "Pickup"}:{" "}
              {formatDate(job.pickupDate)}
            </p>
          )}
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
      {showNotifyToggle && (
        <div
          className="mt-3 pt-3 border-t border-slate-100"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label className="flex items-start gap-2.5 cursor-pointer select-none touch-manipulation">
            <input
              type="checkbox"
              checked={effectiveNotifyCustomer}
              onChange={(e) => onNotifyCustomerChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              aria-describedby={`job-notify-hint-${job.id}`}
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">
                Notify customer
              </span>
              <span
                id={`job-notify-hint-${job.id}`}
                className="block text-[11px] text-slate-500 mt-0.5 leading-snug"
              >
                Uncheck to skip email and SMS when you move or accept this job from the board.
              </span>
            </span>
          </label>
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
  notifyCustomer?: boolean;
  onNotifyCustomerChange?: (notify: boolean) => void;
}

export function JobCard({
  job,
  onJobClick,
  onAccept,
  onReject,
  dragDisabled,
  showMobileStageSelect,
  onStageChange,
  notifyCustomer,
  onNotifyCustomerChange,
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
          notifyCustomer={notifyCustomer}
          onNotifyCustomerChange={onNotifyCustomerChange}
        />
      )}
    </div>
  );
}
