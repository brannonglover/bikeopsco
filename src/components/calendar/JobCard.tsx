"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Job } from "@/lib/types";

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
}: {
  job: Job;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
}) {
  const address =
    job.deliveryType === "COLLECTION_SERVICE"
      ? job.collectionAddress || job.customer?.address
      : job.customer?.address;
  const mapsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-soft min-w-0 w-full sm:min-w-[240px]">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
            job.deliveryType === "COLLECTION_SERVICE"
              ? "bg-amber-100 text-amber-800"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}
        </span>
        {job.dropOffDate && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800" title="Drop-off date">
            {formatDateFull(job.dropOffDate)}
          </span>
        )}
      </div>
      <h3 className="font-semibold text-slate-900">
        {job.bikeMake} {job.bikeModel}
      </h3>
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
    </div>
  );
}

interface JobCardProps {
  job: Job;
  onJobClick?: (job: Job) => void;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
}

export function JobCard({ job, onJobClick, onAccept, onReject }: JobCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: job.id,
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
      {...listeners}
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
        cursor-grab active:cursor-grabbing min-w-0 w-full sm:min-w-[240px]
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
        />
      )}
    </div>
  );
}
