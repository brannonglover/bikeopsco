"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DeliveryType, Job, Stage } from "@/lib/types";
import { applyOptimisticDeliveryType } from "@/lib/optimistic-job-patch";
import { getJobCardBikeTitle, getDisplayPartsForJobBikeRow, getJobServiceSummary } from "@/lib/job-display";
import { useUnreadChatCustomerIds } from "@/contexts/StaffChatAttentionContext";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";
import {
  formatCollectionWindowRangeOrMissing,
  NO_TIME_SLOT_SELECTED,
} from "@/lib/format-collection-window";

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

function customerInitials(job: Job): string {
  if (!job.customer) return "?";
  const first = job.customer.firstName?.trim()?.[0] ?? "";
  const last = job.customer.lastName?.trim()?.[0] ?? "";
  const initials = `${first}${last}`.toUpperCase();
  return initials || "?";
}

function jobCardRef(job: Job): string {
  return `#${job.id.slice(-4).toUpperCase()}`;
}

function JobDeliveryTypeControl({
  job,
  onJobUpdated,
}: {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}) {
  const features = useAppFeatures();
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(job.deliveryType);
  const [error, setError] = useState<string | null>(null);

  const showCollectionOption =
    features.collectionServiceEnabled || job.deliveryType === "COLLECTION_SERVICE";

  useEffect(() => {
    setDeliveryType(job.deliveryType);
    setError(null);
  }, [job.id, job.deliveryType]);

  const badgeClass =
    deliveryType === "COLLECTION_SERVICE"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-700";

  if (!onJobUpdated) {
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${badgeClass}`}>
        {deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}
      </span>
    );
  }

  const persistDeliveryType = (next: DeliveryType) => {
    if (next === job.deliveryType) return;
    setError(null);
    const addr =
      next === "COLLECTION_SERVICE"
        ? (job.collectionAddress ?? job.customer?.address ?? "").trim() || null
        : null;
    const snapshot = job;
    onJobUpdated(applyOptimisticDeliveryType(job, next, addr));
    const body: {
      deliveryType: DeliveryType;
      collectionAddress?: string | null;
    } = { deliveryType: next };
    if (next === "COLLECTION_SERVICE") {
      body.collectionAddress = addr;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as Job & { error?: string };
        if (!res.ok) {
          setDeliveryType(snapshot.deliveryType);
          setError(data.error ?? "Failed to update booking type");
          onJobUpdated(snapshot);
          return;
        }
        onJobUpdated(data);
      } catch {
        setDeliveryType(snapshot.deliveryType);
        setError("Failed to update booking type");
        onJobUpdated(snapshot);
      }
    })();
  };

  return (
    <div
      className="min-w-0"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <select
        value={deliveryType}
        onChange={(e) => {
          const next = e.target.value as DeliveryType;
          setDeliveryType(next);
          persistDeliveryType(next);
        }}
        aria-label="Booking type"
        title={error ?? undefined}
        className={`text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer focus:ring-2 focus:ring-indigo-200 focus:outline-none touch-manipulation max-w-full ${badgeClass}`}
      >
        <option value="DROP_OFF_AT_SHOP">Drop-off</option>
        {showCollectionOption && (
          <option value="COLLECTION_SERVICE">Collection</option>
        )}
      </select>
      {error && (
        <p className="text-[10px] text-red-600 mt-0.5 max-w-[140px] leading-tight">{error}</p>
      )}
    </div>
  );
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
  onJobUpdated,
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
  /** When set, booking type can be changed on the card (Collection ↔ Drop-off). */
  onJobUpdated?: (job: Job) => void;
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

  const isCollection = job.deliveryType === "COLLECTION_SERVICE";
  const pickupWindowLabel = isCollection
    ? formatCollectionWindowRangeOrMissing(
        job.collectionWindowStart,
        job.collectionWindowEnd,
        { shopTimeZone: features.timezone, referenceDate: job.dropOffDate }
      )
    : null;
  const returnWindowLabel = isCollection
    ? formatCollectionWindowRangeOrMissing(
        job.collectionReturnWindowStart,
        job.collectionReturnWindowEnd,
        { shopTimeZone: features.timezone, referenceDate: job.pickupDate }
      )
    : null;

  const containerClass =
    variant === "plain"
      ? "min-w-0 w-full"
      : "group relative min-w-0 w-full overflow-hidden rounded-2xl border border-black/[0.04] bg-[#ffffff] p-4 shadow-job-card transition-shadow hover:shadow-job-card-lg dark:border-slate-700/60 dark:bg-slate-800/95 dark:shadow-none dark:hover:shadow-soft";

  const bikeTitle = getJobCardBikeTitle(job);
  const serviceSummary = getJobServiceSummary(job);

  return (
    <div className={containerClass}>
      <div className="relative min-w-0">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums text-slate-400 dark:text-slate-500">
                {jobCardRef(job)}
              </span>
              <JobDeliveryTypeControl job={job} onJobUpdated={onJobUpdated} />
            </div>
            {job.customer && (
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                aria-hidden
              >
                {customerInitials(job)}
              </span>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">
              {bikeTitle}
            </h3>
            {job.paymentStatus === "PAID" ? (
              <span className="flex-shrink-0 whitespace-nowrap rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                Paid
              </span>
            ) : job.paymentStatus === "PENDING" ? (
              <span className="flex-shrink-0 whitespace-nowrap rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                Partially paid
              </span>
            ) : null}
          </div>
          {serviceSummary && (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              {serviceSummary}
            </p>
          )}
          {job.mechanic?.fullName && (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              Mechanic: {job.mechanic.fullName}
            </p>
          )}
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
      {hasPendingChat && job.customerId && (
        <Link
          href={`/chat?customer=${encodeURIComponent(job.customerId)}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Open chat — customer waiting for reply"
          className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 mt-0.5 hover:text-emerald-800 hover:underline touch-manipulation pointer-events-auto w-fit"
        >
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Chat waiting
        </Link>
      )}
      {job.customer && (
        <p className="mt-1.5 text-sm font-medium text-slate-700 dark:text-slate-300" title={`${job.customer.firstName}${job.customer.lastName ? ` ${job.customer.lastName}` : ""}`}>
          {job.customer.lastName
            ? `${job.customer.firstName} ${job.customer.lastName}`
            : job.customer.firstName}
        </p>
      )}
      {(job.dropOffDate || job.pickupDate || isCollection || job.stage === "PENDING_APPROVAL") && (
        <div className="mt-2.5 space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p>
            {isCollection ? "Collection" : "Drop-off"}:{" "}
            {job.dropOffDate ? (
              formatDate(job.dropOffDate)
            ) : (
              <span className="italic text-slate-400">{NO_TIME_SLOT_SELECTED}</span>
            )}
            {isCollection && job.dropOffDate && (
              <>
                {" · "}
                {pickupWindowLabel === NO_TIME_SLOT_SELECTED ? (
                  <span className="italic text-slate-400">{pickupWindowLabel}</span>
                ) : (
                  pickupWindowLabel
                )}
              </>
            )}
          </p>
          {(job.pickupDate || isCollection) && (
            <p>
              {isCollection ? "Return" : "Pickup"}:{" "}
              {job.pickupDate ? (
                formatDate(job.pickupDate)
              ) : (
                <span className="italic text-slate-400">{NO_TIME_SLOT_SELECTED}</span>
              )}
              {isCollection && job.pickupDate && (
                <>
                  {" · "}
                  {returnWindowLabel === NO_TIME_SLOT_SELECTED ? (
                    <span className="italic text-slate-400">{returnWindowLabel}</span>
                  ) : (
                    returnWindowLabel
                  )}
                </>
              )}
            </p>
          )}
        </div>
      )}
      {job.customerNotes && (
        <p className="mt-2 text-xs text-slate-600 italic line-clamp-2" title={job.customerNotes}>
          {job.customerNotes}
        </p>
      )}
      {address && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700/60">
          <p className="mb-1 truncate text-xs text-slate-600 dark:text-slate-400" title={address}>
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
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
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
          className="mt-3 border-t border-slate-100 pt-3 md:hidden dark:border-slate-700/60"
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
          className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700/60"
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
  onJobUpdated?: (job: Job) => void;
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
  onJobUpdated,
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
        <div className="min-h-[120px] rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/50" />
      ) : (
        <JobCardContent
          job={job}
          onAccept={onAccept}
          onReject={onReject}
          showMobileStageSelect={showMobileStageSelect}
          onStageChange={onStageChange}
          notifyCustomer={notifyCustomer}
          onNotifyCustomerChange={onNotifyCustomerChange}
          onJobUpdated={onJobUpdated}
        />
      )}
    </div>
  );
}
