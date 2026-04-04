"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { StageColumn } from "./StageColumn";
import { MobileJobQueue } from "./MobileJobQueue";
import { JobCardContent } from "./JobCard";
import { RejectBookingModal } from "./RejectBookingModal";
import { NewJobModal } from "@/components/jobs/NewJobModal";
import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import { useJobNotifications } from "@/hooks/useJobNotifications";
import { useIsMobileBoard } from "@/hooks/useIsMobileBoard";
import type { Job, Stage } from "@/lib/types";

const STAGES: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
  "CANCELLED",
];

/** Main board columns - Cancelled is shown in a collapsible section below */
const DISPLAY_STAGES: Stage[] = STAGES.filter((s) => s !== "CANCELLED");

export function KanbanBoard() {
  const searchParams = useSearchParams();
  const paidJobId = searchParams.get("paid");
  const [showPaidBanner, setShowPaidBanner] = useState(!!paidJobId);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelledExpanded, setCancelledExpanded] = useState(false);
  const [newJobModalOpen, setNewJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [rejectingJob, setRejectingJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const isMobileBoard = useIsMobileBoard();

  const fetchJobs = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    fetch("/api/jobs")
      .then((res) => res.json())
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  useJobNotifications(jobs, () => fetchJobs({ silent: true }));

  const handleJobCreated = useCallback((job: Job) => {
    setJobs((prev) => {
      const without = prev.filter((j) => j.id !== job.id);
      return [job, ...without];
    });
  }, []);

  const handleAccept = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "BOOKED_IN" }),
        });
        if (res.ok) {
          const updated = await res.json();
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? updated : j))
          );
          if (selectedJob?.id === jobId) {
            setSelectedJob(updated);
          }
        }
      } catch (e) {
        console.error("Failed to accept job", e);
      }
    },
    [selectedJob?.id]
  );

  const handleRejectClick = useCallback((job: Job) => {
    setRejectingJob(job);
  }, []);

  const handleRejectConfirm = useCallback(
    async (jobId: string, reason: string) => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "CANCELLED",
            cancellationReason: reason.trim(),
          }),
        });
        if (res.ok) {
          const updated = await res.json();
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? updated : j))
          );
          if (selectedJob?.id === jobId) setSelectedJob(null);
        }
      } catch (e) {
        console.error("Failed to reject job", e);
      }
    },
    [selectedJob?.id]
  );

  const handleArchiveCompleted = useCallback(async () => {
    const count = jobs.filter((j) => j.stage === "COMPLETED").length;
    if (count === 0) return;
    setArchiving(true);
    try {
      const res = await fetch("/api/jobs/archive-completed", { method: "POST" });
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.stage !== "COMPLETED"));
        if (selectedJob?.stage === "COMPLETED") setSelectedJob(null);
      }
    } finally {
      setArchiving(false);
    }
  }, [jobs, selectedJob?.stage]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (paidJobId) {
      fetchJobs();
    }
  }, [paidJobId, fetchJobs]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJobId(event.active.id as string);
  };

  const patchJobStage = useCallback(async (jobId: string, newStage: Stage) => {
    let previousStage: Stage | undefined;
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId);
      if (!job || job.stage === newStage) return prev;
      previousStage = job.stage;
      return prev.map((j) => (j.id === jobId ? { ...j, stage: newStage } : j));
    });
    if (previousStage === undefined) return;

    setSelectedJob((sel) =>
      sel?.id === jobId ? { ...sel, stage: newStage } : sel
    );

    const revert = () => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, stage: previousStage! } : j
        )
      );
      setSelectedJob((sel) =>
        sel?.id === jobId ? { ...sel, stage: previousStage! } : sel
      );
    };

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
        setSelectedJob((sel) => (sel?.id === jobId ? updated : sel));
      } else {
        revert();
      }
    } catch (e) {
      console.error("Failed to update job", e);
      revert();
    }
  }, []);

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
    await patchJobStage(jobId, newStage);
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

  const completedCount = jobs.filter((j) => j.stage === "COMPLETED").length;

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
      <RejectBookingModal
        job={rejectingJob}
        isOpen={!!rejectingJob}
        onClose={() => setRejectingJob(null)}
        onReject={handleRejectConfirm}
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleArchiveCompleted}
            disabled={archiving || completedCount === 0}
            className="px-4 py-3 border border-slate-300 bg-white text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 touch-manipulation min-h-[44px]"
          >
            {archiving
              ? "Archive Completed"
              : completedCount > 0
                ? `Archive (${completedCount})`
                : "Archive"}
          </button>
          <button
            onClick={() => setNewJobModalOpen(true)}
            className="px-5 py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm shadow-soft hover:bg-amber-600 hover:shadow-soft-lg transition-all duration-200 touch-manipulation min-h-[44px] w-full sm:w-auto"
          >
            New Job
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <MobileJobQueue
          pendingJobs={jobsByStage.PENDING_APPROVAL || []}
          bookedInJobs={jobsByStage.BOOKED_IN || []}
          onJobClick={(job) => setSelectedJob(job)}
          onAccept={handleAccept}
          onReject={handleRejectClick}
        />

        <p className="md:hidden text-xs font-medium text-slate-400 -mb-1 flex-shrink-0">
          Swipe columns to browse — on mobile, use Status on a card to move it
        </p>
        <div className="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden pb-4 min-h-0 w-full -mx-4 px-4 sm:mx-0 sm:px-0 overscroll-x-contain">
          {DISPLAY_STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              jobs={jobsByStage[stage] || []}
              onJobClick={(job) => setSelectedJob(job)}
              onAccept={stage === "PENDING_APPROVAL" ? handleAccept : undefined}
              onReject={
                stage === "PENDING_APPROVAL" ? handleRejectClick : undefined
              }
              dragDisabled={isMobileBoard}
              showMobileStageSelect={isMobileBoard}
              onStageChange={patchJobStage}
            />
          ))}
        </div>

        {jobsByStage.CANCELLED?.length ? (
          <div className="flex-shrink-0 border-t border-slate-200 pt-4 mt-2">
            <button
              type="button"
              onClick={() => setCancelledExpanded((e) => !e)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-red-100 text-red-800">
                Cancelled ({jobsByStage.CANCELLED.length})
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${cancelledExpanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {cancelledExpanded && (
              <div className="mt-3 flex flex-wrap gap-3">
                {jobsByStage.CANCELLED.map((job) => (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedJob(job);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:ring-2 hover:ring-red-200 rounded-xl transition-shadow"
                  >
                    <JobCardContent job={job} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

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
