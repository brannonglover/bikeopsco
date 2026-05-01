"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { JobCard } from "./JobCard";
import type { Job, Stage } from "@/lib/types";

type JobStageChangeHandler = (jobId: string, stage: Stage) => void;

const STAGE_HEADER_COLORS: Record<Stage, string> = {
  PENDING_APPROVAL: "bg-amber-600 dark:bg-amber-800",
  BOOKED_IN: "bg-slate-500 dark:bg-slate-700",
  RECEIVED: "bg-slate-600 dark:bg-slate-800",
  WORKING_ON: "bg-amber-500 dark:bg-amber-700",
  WAITING_ON_CUSTOMER: "bg-violet-500 dark:bg-violet-700",
  WAITING_ON_PARTS: "bg-amber-400 dark:bg-amber-600",
  BIKE_READY: "bg-emerald-500 dark:bg-emerald-700",
  COMPLETED: "bg-indigo-500 dark:bg-indigo-700",
  CANCELLED: "bg-red-500 dark:bg-red-700",
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
}: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[200px] sm:min-w-[160px] flex-shrink-0 flex flex-col rounded-xl border transition-all duration-200 min-h-[320px] sm:min-h-[calc(100vh-14rem)] ${
        isOver
          ? "border-indigo-400 bg-indigo-50/60 shadow-glow"
          : "border-slate-200/80 bg-white/60 shadow-soft"
      }`}
    >
      <div className={`${STAGE_HEADER_COLORS[stage]} flex items-center justify-between gap-3 rounded-t-xl px-4 py-2.5 text-white flex-shrink-0`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="truncate text-sm font-semibold leading-tight">
            {STAGE_LABELS[stage]}
          </h2>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/20 px-2 text-xs font-bold text-white">
          {jobs.length}
        </span>
      </div>
      <div className="p-3 flex flex-col gap-3 overflow-y-auto overflow-x-hidden flex-1 min-h-[400px] min-w-0">
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
              />
            ))
          ) : (
            <div className="flex min-h-[96px] items-center justify-center rounded-xl border border-dashed border-surface-border bg-subtle-bg/60 px-4 py-5 text-center">
              <p className="text-sm font-medium text-muted">No Jobs</p>
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
