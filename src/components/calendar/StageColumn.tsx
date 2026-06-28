"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { JobCard } from "./JobCard";
import type { Job, Stage } from "@/lib/types";

type JobStageChangeHandler = (jobId: string, stage: Stage) => void;

const STAGE_DOT_COLORS: Record<Stage, string> = {
  PENDING_APPROVAL: "bg-amber-500",
  BOOKED_IN: "bg-slate-400 dark:bg-slate-500",
  RECEIVED: "bg-slate-500 dark:bg-slate-400",
  WORKING_ON: "bg-amber-500",
  WAITING_ON_CUSTOMER: "bg-violet-500",
  WAITING_ON_PARTS: "bg-orange-400",
  BIKE_READY: "bg-emerald-500",
  COMPLETED: "bg-indigo-500",
  CANCELLED: "bg-red-500",
};

const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_CUSTOMER: "Waiting on Customer",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

interface StageColumnProps {
  stage: Stage;
  jobs: Job[];
  onJobClick?: (job: Job) => void;
  onAccept?: (jobId: string) => void;
  onReject?: (job: Job) => void;
  dragDisabled?: boolean;
  showMobileStageSelect?: boolean;
  onStageChange?: JobStageChangeHandler;
  jobNotifyCustomer?: (jobId: string) => boolean;
  onJobNotifyCustomerChange?: (jobId: string, notify: boolean) => void;
  onJobUpdated?: (job: Job) => void;
}

export function StageColumn({
  stage,
  jobs,
  onJobClick,
  onAccept,
  onReject,
  dragDisabled,
  showMobileStageSelect,
  onStageChange,
  jobNotifyCustomer,
  onJobNotifyCustomerChange,
  onJobUpdated,
}: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-[320px] min-w-[200px] flex-1 flex-shrink-0 flex-col sm:min-w-[168px] transition-colors duration-200 ${
        isOver ? "rounded-xl bg-primary-500/5 ring-1 ring-primary-500/20" : ""
      }`}
    >
      <div className="mb-3 flex flex-shrink-0 items-center gap-2 px-0.5">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${STAGE_DOT_COLORS[stage]}`}
          aria-hidden
        />
        <h2 className="min-w-0 truncate text-[13px] font-semibold uppercase tracking-wide text-text-secondary">
          {STAGE_LABELS[stage]}
        </h2>
        <span className="ml-auto flex h-[22px] min-w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-subtle-bg px-1.5 text-[11px] font-bold tabular-nums text-text-tertiary">
          {jobs.length}
        </span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-0.5">
        <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
          {jobs.length > 0 ? (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onJobClick={onJobClick}
                onAccept={onAccept}
                onReject={onReject}
                dragDisabled={dragDisabled}
                showMobileStageSelect={showMobileStageSelect}
                onStageChange={
                  onStageChange ? (s) => onStageChange(job.id, s) : undefined
                }
                notifyCustomer={
                  jobNotifyCustomer ? jobNotifyCustomer(job.id) : undefined
                }
                onNotifyCustomerChange={
                  onJobNotifyCustomerChange
                    ? (notify) => onJobNotifyCustomerChange(job.id, notify)
                    : undefined
                }
                onJobUpdated={onJobUpdated}
              />
            ))
          ) : (
            <p className="py-10 text-center text-sm font-medium text-text-muted">No jobs</p>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
