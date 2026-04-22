"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { StageColumn } from "./StageColumn";
import { MobileJobQueue } from "./MobileJobQueue";
import { JobCardContent } from "./JobCard";
import { RejectBookingModal } from "./RejectBookingModal";
import { NewJobModal } from "@/components/jobs/NewJobModal";
import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import { useJobNotifications } from "@/hooks/useJobNotifications";
import { useIsMobileBoard } from "@/hooks/useIsMobileBoard";
import type { Job, Stage } from "@/lib/types";
import { getJobBikeDisplayTitle } from "@/lib/job-display";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";
import { JOBS_REFRESH_EVENT } from "@/lib/jobs-refresh";

function formatShortDate(d: Date | string | null) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function customerLine(job: Job) {
  if (!job.customer) return "Customer";
  const { firstName, lastName } = job.customer;
  return lastName ? `${firstName} ${lastName}` : firstName;
}

const STAGES: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
  "CANCELLED",
];

/** Main board columns - Pending approvals + Cancelled are shown outside the main scroll columns. */
const DISPLAY_STAGES: Stage[] = STAGES.filter(
  (s) => s !== "CANCELLED" && s !== "PENDING_APPROVAL"
);

/** Match PATCH semantics so the card does not “snap” again when the server JSON arrives. */
function withOptimisticStageChange(job: Job, newStage: Stage): Job {
  const bikes = job.jobBikes ?? [];
  const incomplete = bikes.filter((b) => !b.completedAt);

  if (newStage === "WAITING_ON_PARTS") {
    const wid = job.workingOnJobBikeId;
    if (job.stage !== "WAITING_ON_PARTS" && wid) {
      const now = new Date().toISOString();
      return {
        ...job,
        stage: newStage,
        workingOnJobBikeId: null,
        jobBikes: bikes.map((b) =>
          b.id === wid && !b.completedAt
            ? { ...b, waitingOnPartsAt: now }
            : b
        ),
      };
    }
    return { ...job, stage: newStage };
  }

  let next: Job = {
    ...job,
    stage: newStage,
    jobBikes: bikes.map((b) =>
      b.completedAt ? b : { ...b, waitingOnPartsAt: null }
    ),
  };

  if (newStage === "WORKING_ON" && incomplete.length === 1) {
    next = { ...next, workingOnJobBikeId: incomplete[0].id };
  } else if (newStage !== "WORKING_ON") {
    next = { ...next, workingOnJobBikeId: null };
  }

  if (newStage === "COMPLETED") {
    next = { ...next, completedAt: new Date().toISOString() };
  }

  return next;
}

function cloneJobForRevert(job: Job): Job {
  return {
    ...job,
    jobBikes: job.jobBikes?.map((b) => ({ ...b })),
  };
}

export function KanbanBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const features = useAppFeatures();
  const paidJobId = searchParams.get("paid");
  const openJobId = searchParams.get("openJob");
  const [showPaidBanner, setShowPaidBanner] = useState(!!paidJobId);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelledExpanded, setCancelledExpanded] = useState(false);
  const [newJobModalOpen, setNewJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [rejectingJob, setRejectingJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  /** Job IDs for which board actions should not send customer email/SMS. */
  const [jobsSkippingCustomerNotify, setJobsSkippingCustomerNotify] = useState<
    Set<string>
  >(() => new Set());
  const isMobileBoard = useIsMobileBoard();

  const jobNotifyCustomer = useCallback(
    (jobId: string) => (features.notifyCustomerEnabled ? !jobsSkippingCustomerNotify.has(jobId) : false),
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify]
  );

  const onJobNotifyCustomerChange = useCallback(
    (jobId: string, notify: boolean) => {
      if (!features.notifyCustomerEnabled) return;
      setJobsSkippingCustomerNotify((prev) => {
        const next = new Set(prev);
        if (notify) next.delete(jobId);
        else next.add(jobId);
        return next;
      });
    },
    [features.notifyCustomerEnabled]
  );

  const fetchJobs = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    fetch("/api/jobs?view=board", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const next = Array.isArray(data) ? (data as Job[]) : [];
        setJobs(next);
        // Keep the detail modal in sync if it's open, without clobbering fields
        // that aren't returned by the board view (e.g. jobServices/jobProducts).
        setSelectedJob((prev) => {
          if (!prev) return prev;
          const refreshed = next.find((j) => j.id === prev.id);
          if (!refreshed) return prev;
          return { ...prev, ...refreshed };
        });
      })
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  useJobNotifications(jobs, () => fetchJobs({ silent: true }));

  useEffect(() => {
    const handler = () => fetchJobs({ silent: true });
    window.addEventListener(JOBS_REFRESH_EVENT, handler);
    return () => window.removeEventListener(JOBS_REFRESH_EVENT, handler);
  }, [fetchJobs]);

  const handleJobCreated = useCallback((job: Job) => {
    setJobs((prev) => {
      const without = prev.filter((j) => j.id !== job.id);
      return [job, ...without];
    });
  }, []);

  const handleAccept = useCallback(
    async (jobId: string) => {
      try {
        const body: Record<string, unknown> = { stage: "BOOKED_IN" };
        if (!features.notifyCustomerEnabled || jobsSkippingCustomerNotify.has(jobId)) {
          body.notifyCustomer = false;
        }
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify, selectedJob?.id]
  );

  const handleRejectClick = useCallback((job: Job) => {
    setRejectingJob(job);
  }, []);

  const handleRejectConfirm = useCallback(
    async (jobId: string, reason: string) => {
      try {
        const body: Record<string, unknown> = {
          stage: "CANCELLED",
          cancellationReason: reason.trim(),
        };
        if (!features.notifyCustomerEnabled || jobsSkippingCustomerNotify.has(jobId)) {
          body.notifyCustomer = false;
        }
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify, selectedJob?.id]
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

  useEffect(() => {
    if (!openJobId || loading) return;
    const job = jobs.find((j) => j.id === openJobId);
    if (job) {
      setSelectedJob(job);
      router.replace("/", { scroll: false });
    }
  }, [openJobId, jobs, loading, router]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJobId(event.active.id as string);
  };

  const reorderColumnJobs = useCallback(
    async (updates: { id: string; columnSortOrder: number }[]) => {
      try {
        await fetch("/api/jobs/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
      } catch (e) {
        console.error("Failed to persist job reorder", e);
      }
    },
    []
  );

  const patchJobStage = useCallback(
    async (jobId: string, newStage: Stage, opts?: { endDrag?: boolean }) => {
      const endDrag = opts?.endDrag ?? false;
      let previousStage: Stage | undefined;
      let revertSnapshot: Job | null = null;
      flushSync(() => {
        if (endDrag) setActiveJobId(null);
        setJobs((prev) => {
          const job = prev.find((j) => j.id === jobId);
          if (!job || job.stage === newStage) return prev;
          previousStage = job.stage;
          revertSnapshot = cloneJobForRevert(job);
          return prev.map((j) =>
            j.id === jobId ? withOptimisticStageChange(job, newStage) : j
          );
        });
        if (previousStage !== undefined) {
          setSelectedJob((sel) =>
            sel?.id === jobId ? withOptimisticStageChange(sel, newStage) : sel
          );
        }
      });
      if (previousStage === undefined) return;

      const revert = () => {
        if (!revertSnapshot) return;
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? revertSnapshot! : j))
        );
        setSelectedJob((sel) =>
          sel?.id === jobId ? revertSnapshot! : sel
        );
      };

      try {
        const body: Record<string, unknown> = { stage: newStage };
        if (!features.notifyCustomerEnabled || jobsSkippingCustomerNotify.has(jobId)) {
          body.notifyCustomer = false;
        }
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    },
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveJobId(null);
      return;
    }

    const jobId = active.id as string;
    const activeJob = jobs.find((j) => j.id === jobId);

    let newStage: Stage;
    if (STAGES.includes(over.id as Stage)) {
      newStage = over.id as Stage;
    } else {
      const targetJob = jobs.find((j) => j.id === over.id);
      newStage = targetJob ? targetJob.stage : (over.id as Stage);
    }

    // Within-column reorder: same stage and dropped on a card (not a column background)
    if (
      activeJob &&
      newStage === activeJob.stage &&
      !STAGES.includes(over.id as Stage)
    ) {
      const columnJobs = jobsByStage[newStage] ?? [];
      const oldIndex = columnJobs.findIndex((j) => j.id === jobId);
      const newIndex = columnJobs.findIndex((j) => j.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(columnJobs, oldIndex, newIndex);
        const updates = reordered.map((j, i) => ({
          id: j.id,
          columnSortOrder: i * 1000,
        }));

        flushSync(() => {
          setActiveJobId(null);
          setJobs((prev) => {
            const orderMap = new Map(
              updates.map((u) => [u.id, u.columnSortOrder])
            );
            return prev.map((j) =>
              orderMap.has(j.id)
                ? { ...j, columnSortOrder: orderMap.get(j.id)! }
                : j
            );
          });
        });

        void reorderColumnJobs(updates);
        return;
      }

      setActiveJobId(null);
      return;
    }

    void patchJobStage(jobId, newStage, { endDrag: true });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const jobsByStage = STAGES.reduce((acc, stage) => {
    const stageJobs = jobs
      .filter((j) => j.stage === stage)
      .sort((a, b) => {
        const aOrder = a.columnSortOrder ?? Infinity;
        const bOrder = b.columnSortOrder ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if (!a.dropOffDate && !b.dropOffDate) return 0;
        if (!a.dropOffDate) return 1;
        if (!b.dropOffDate) return -1;
        return new Date(a.dropOffDate).getTime() - new Date(b.dropOffDate).getTime();
      });
    return { ...acc, [stage]: stageJobs };
  }, {} as Record<Stage, Job[]>);

  const pendingApprovals = jobsByStage.PENDING_APPROVAL || [];
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
          // If the job was archived, it no longer belongs on the active board list.
          if (updated.archivedAt) {
            setSelectedJob(null);
            setJobs((prev) => prev.filter((j) => j.id !== updated.id));
            return;
          }
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
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-start justify-between gap-4 flex-shrink-0">
        <div className="flex items-start gap-4 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex-shrink-0">
            Job Board
          </h1>
          {pendingApprovals.length > 0 ? (
            <div className="hidden md:block w-[420px] max-w-full">
              <section className="rounded-2xl border border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-white shadow-soft overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-600 dark:bg-amber-800 text-white">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-sm font-bold flex-shrink-0"
                      aria-hidden
                    >
                      {pendingApprovals.length}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold leading-tight truncate">
                        Pending approval
                      </p>
                      <p className="text-[11px] text-amber-100/95 font-medium truncate">
                        Booking{pendingApprovals.length === 1 ? "" : "s"} waiting on a yes/no
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchJobs({ silent: true })}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/20 transition-colors flex-shrink-0"
                    title="Refresh"
                  >
                    Refresh
                  </button>
                </div>
                <ul className="divide-y divide-amber-100/80 max-h-[232px] overflow-y-auto">
                  {pendingApprovals.map((job) => (
                    <li key={job.id} className="p-3">
                      <button
                        type="button"
                        onClick={() => setSelectedJob(job)}
                        className="w-full text-left rounded-xl px-1 py-0.5 -mx-1 -my-0.5 hover:bg-amber-50/70 transition-colors"
                        title="Open booking request"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 truncate">
                              {customerLine(job)}
                            </p>
                            <p className="text-sm text-slate-600 truncate">
                              {getJobBikeDisplayTitle(job)}
                            </p>
                          </div>
                          {job.dropOffDate && (
                            <span
                              className="flex-shrink-0 text-[10px] font-semibold text-amber-900/80 bg-amber-100 px-2 py-1 rounded-md self-start"
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
                            handleAccept(job.id);
                          }}
                          className="flex-1 min-h-[36px] rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors touch-manipulation"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRejectClick(job);
                          }}
                          className="flex-1 min-h-[36px] rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 hover:bg-red-100 active:bg-red-100 transition-colors touch-manipulation"
                        >
                          Reject
                        </button>
                      </div>
                      {features.notifyCustomerEnabled &&
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
                                Uncheck to skip email and SMS when accepting or rejecting from the board.
                              </span>
                            </span>
                          </label>
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}
        </div>
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
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <MobileJobQueue
          pendingJobs={jobsByStage.PENDING_APPROVAL || []}
          bookedInJobs={jobsByStage.BOOKED_IN || []}
          onJobClick={(job) => setSelectedJob(job)}
          onAccept={handleAccept}
          onReject={handleRejectClick}
          jobNotifyCustomer={jobNotifyCustomer}
          onJobNotifyCustomerChange={onJobNotifyCustomerChange}
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
              dragDisabled={isMobileBoard}
              showMobileStageSelect={isMobileBoard}
              onStageChange={patchJobStage}
              jobNotifyCustomer={jobNotifyCustomer}
              onJobNotifyCustomerChange={onJobNotifyCustomerChange}
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

        <DragOverlay dropAnimation={{ duration: 0 }}>
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
