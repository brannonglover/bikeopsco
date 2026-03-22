"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { JobCard } from "./JobCard";
import type { Job, Stage } from "@/lib/types";

const STAGE_COLORS: Record<Stage, string> = {
  RECEIVED: "bg-slate-600",
  WORKING_ON: "bg-amber-500",
  WAITING_ON_PARTS: "bg-amber-400",
  BIKE_READY: "bg-emerald-500",
  COMPLETED: "bg-indigo-500",
  CANCELLED: "bg-red-500",
};

const STAGE_LABELS: Record<Stage, string> = {
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

interface StageColumnProps {
  stage: Stage;
  jobs: Job[];
  onJobClick?: (job: Job) => void;
}

export function StageColumn({ stage, jobs, onJobClick }: StageColumnProps) {
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
      <div
        className={`${STAGE_COLORS[stage]} text-white px-4 py-2.5 rounded-t-xl font-semibold text-sm flex-shrink-0`}
      >
        {STAGE_LABELS[stage]} ({jobs.length})
      </div>
      <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-[400px]">
        <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onJobClick={onJobClick} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
