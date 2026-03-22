"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { StageColumn } from "./StageColumn";
import { JobCardContent } from "./JobCard";
import { NewJobModal } from "@/components/jobs/NewJobModal";
import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import type { Job, Stage } from "@/lib/types";

const STAGES: Stage[] = [
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
  "CANCELLED",
];

export function KanbanBoard() {
  const searchParams = useSearchParams();
  const paidJobId = searchParams.get("paid");
  const [showPaidBanner, setShowPaidBanner] = useState(!!paidJobId);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [newJobModalOpen, setNewJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = () => {
    setLoading(true);
    fetch("/api/jobs")
      .then((res) => res.json())
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  };

  const handleJobCreated = (job: Job) => {
    setJobs((prev) => [job, ...prev]);
  };

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paidJobId) {
      fetchJobs();
    }
  }, [paidJobId]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJobId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveJobId(null);
    const { active, over } = event;
    if (!over) return;

    const jobId = active.id as string;
    let newStage: Stage;
    if (STAGES.includes(over.id as Stage)) {
      newStage = over.id as Stage;
    } else {
      const targetJob = jobs.find((j) => j.id === over.id);
      newStage = targetJob ? targetJob.stage : (over.id as Stage);
    }
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.stage === newStage) return;

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, stage: newStage } : j
          )
        );
      }
    } catch (e) {
      console.error("Failed to update job", e);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const jobsByStage = STAGES.reduce(
    (acc, stage) => ({ ...acc, [stage]: jobs.filter((j) => j.stage === stage) }),
    {} as Record<Stage, Job[]>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 font-medium">
        Loading jobs...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      <NewJobModal
        isOpen={newJobModalOpen}
        onClose={() => setNewJobModalOpen(false)}
        onSuccess={handleJobCreated}
      />
      <JobDetailModal
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onJobUpdated={(updated) => {
          setSelectedJob(updated);
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        }}
        onJobDeleted={(jobId) => {
          setSelectedJob(null);
          setJobs((prev) => prev.filter((j) => j.id !== jobId));
        }}
      />
      {showPaidBanner && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-800"
          role="status"
        >
          <span className="font-medium">Payment received successfully.</span>
          <button
            type="button"
            onClick={() => {
              setShowPaidBanner(false);
              window.history.replaceState({}, "", "/calendar");
            }}
            className="text-emerald-600 hover:text-emerald-800 font-medium"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Job Board</h1>
        <button
          onClick={() => setNewJobModalOpen(true)}
          className="px-5 py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm shadow-soft hover:bg-amber-600 hover:shadow-soft-lg transition-all duration-200 touch-manipulation min-h-[44px] w-full sm:w-auto"
        >
          New Job
        </button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden pb-4 min-h-0 w-full -mx-4 px-4 sm:mx-0 sm:px-0 overscroll-x-contain">
          {STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              jobs={jobsByStage[stage] || []}
              onJobClick={(job) => setSelectedJob(job)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {(() => {
            const job = activeJobId ? jobs.find((j) => j.id === activeJobId) : null;
            return job ? (
              <div className="rotate-2 scale-[1.02] cursor-grabbing shadow-soft-lg">
                <JobCardContent job={job} />
              </div>
            ) : null;
          })()}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
