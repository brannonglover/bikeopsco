"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { Check, RefreshCw, X } from "lucide-react";
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

function mergeJobPreservingInvoiceDetails(prev: Job, next: Job): Job {
  const merged = { ...prev, ...next };
  const nextServices = next.jobServices ?? [];
  const nextProducts = next.jobProducts ?? [];

  if (nextServices.length > 0 && nextServices.some((js) => !js.id)) {
    merged.jobServices = prev.jobServices;
  }
  if (nextProducts.length > 0 && nextProducts.some((jp) => !jp.id || !jp.productId)) {
    merged.jobProducts = prev.jobProducts;
  }

  return merged;
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

type ColumnSortUpdate = { id: string; columnSortOrder: number };

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
  } else {
    next = { ...next, completedAt: null };
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
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const dismissDateToastJobIdRef = useRef<string | null>(null);
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
          return mergeJobPreservingInvoiceDetails(prev, refreshed);
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

  const showSavedToast = useCallback((message: string) => {
    setSavedToast(message);
    window.setTimeout(() => setSavedToast(null), 3000);
  }, []);

  useEffect(() => {
    if (selectedJob) dismissDateToastJobIdRef.current = null;
  }, [selectedJob]);

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
      router.replace("/calendar", { scroll: false });
    }
  }, [openJobId, jobs, loading, router]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJobId(event.active.id as string);
  };

  const reorderColumnJobs = useCallback(
    async (updates: ColumnSortUpdate[]) => {
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
    async (
      jobId: string,
      newStage: Stage,
      opts?: { endDrag?: boolean; sortUpdates?: ColumnSortUpdate[] }
    ) => {
      const endDrag = opts?.endDrag ?? false;
      const sortUpdates = opts?.sortUpdates ?? [];
      const sortMap = new Map(
        sortUpdates.map((u) => [u.id, u.columnSortOrder])
      );
      let previousStage: Stage | undefined;
      let revertSnapshots = new Map<string, Job>();
      flushSync(() => {
        if (endDrag) setActiveJobId(null);
        setJobs((prev) => {
          const job = prev.find((j) => j.id === jobId);
          if (!job || job.stage === newStage) return prev;
          previousStage = job.stage;
          const snapshotIds = new Set([jobId, ...sortMap.keys()]);
          revertSnapshots = new Map(
            prev
              .filter((j) => snapshotIds.has(j.id))
              .map((j) => [j.id, cloneJobForRevert(j)])
          );
          return prev.map((j) => {
            if (j.id === jobId) {
              const next = withOptimisticStageChange(job, newStage);
              return sortMap.has(j.id)
                ? { ...next, columnSortOrder: sortMap.get(j.id)! }
                : next;
            }
            return sortMap.has(j.id)
              ? { ...j, columnSortOrder: sortMap.get(j.id)! }
              : j;
          });
        });
        if (previousStage !== undefined) {
          setSelectedJob((sel) =>
            sel?.id === jobId
              ? {
                  ...withOptimisticStageChange(sel, newStage),
                  ...(sortMap.has(jobId)
                    ? { columnSortOrder: sortMap.get(jobId)! }
                    : {}),
                }
              : sel
          );
        }
      });
      if (previousStage === undefined) return;

      const revert = () => {
        if (revertSnapshots.size === 0) return;
        setJobs((prev) =>
          prev.map((j) => revertSnapshots.get(j.id) ?? j)
        );
        setSelectedJob((sel) =>
          sel?.id === jobId ? revertSnapshots.get(jobId) ?? sel : sel
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
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? sortMap.has(jobId)
                  ? { ...updated, columnSortOrder: sortMap.get(jobId)! }
                  : updated
                : j
            )
          );
          setSelectedJob((sel) =>
            sel?.id === jobId
              ? sortMap.has(jobId)
                ? { ...updated, columnSortOrder: sortMap.get(jobId)! }
                : updated
              : sel
          );
          if (sortUpdates.length > 0) {
            void reorderColumnJobs(sortUpdates);
          }
        } else {
          revert();
        }
      } catch (e) {
        console.error("Failed to update job", e);
        revert();
      }
    },
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify, reorderColumnJobs]
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

    let sortUpdates: ColumnSortUpdate[] | undefined;
    if (activeJob && newStage !== activeJob.stage) {
      const destinationJobs = (jobsByStage[newStage] ?? []).filter(
        (j) => j.id !== jobId
      );
      let insertIndex = destinationJobs.length;

      if (!STAGES.includes(over.id as Stage)) {
        const targetIndex = destinationJobs.findIndex((j) => j.id === over.id);
        if (targetIndex !== -1) insertIndex = targetIndex;
      }

      const reordered = [
        ...destinationJobs.slice(0, insertIndex),
        activeJob,
        ...destinationJobs.slice(insertIndex),
      ];
      sortUpdates = reordered.map((j, i) => ({
        id: j.id,
        columnSortOrder: i * 1000,
      }));
    }

    void patchJobStage(jobId, newStage, { endDrag: true, sortUpdates });
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
        onDismissIntent={() => {
          dismissDateToastJobIdRef.current = selectedJob?.id ?? null;
        }}
        onJobUpdated={(updated) => {
          // If the job was archived, it no longer belongs on the active board list.
          if (updated.archivedAt) {
            setSelectedJob(null);
            setJobs((prev) => prev.filter((j) => j.id !== updated.id));
            return;
          }
          setSelectedJob((prev) => (prev?.id === updated.id ? updated : prev));
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        }}
        onJobDateSaved={(field, jobId) => {
          if (dismissDateToastJobIdRef.current !== jobId) return;
          dismissDateToastJobIdRef.current = null;
          const label =
            field === "pickupDate"
              ? "Pickup date"
              : field === "dropOffDate"
                ? "Drop-off date"
                : "Collection window";
          showSavedToast(`${label} updated`);
        }}
        onJobDeleted={(jobId) => {
          setSelectedJob(null);
          setJobs((prev) => prev.filter((j) => j.id !== jobId));
        }}
      />
      {savedToast && (
        <div
          className="fixed right-4 top-4 z-[70] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-soft"
          role="status"
        >
          {savedToast}
        </div>
      )}
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
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 flex-shrink-0">
        <div className="flex flex-col min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex-shrink-0">
            Job Board
          </h1>
          {pendingApprovals.length > 0 ? (
            <div className="hidden md:block mt-2 w-full max-w-4xl">
              <section className="rounded-xl border border-surface-border bg-surface shadow-sm dark:shadow-none overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-surface-border-subtle px-3 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 text-xs font-bold text-amber-800 dark:text-amber-300 flex-shrink-0"
                      aria-hidden
                    >
                      {pendingApprovals.length}
                    </span>
                    <p className="text-sm font-semibold leading-tight text-heading truncate">
                      Pending approval
                    </p>
                    <span className="text-xs text-secondary truncate">
                      Booking{pendingApprovals.length === 1 ? "" : "s"} waiting on a yes/no
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchJobs({ silent: true })}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-subtle-bg hover:text-heading transition-colors flex-shrink-0"
                    title="Refresh"
                    aria-label="Refresh pending approvals"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <ul className="max-h-[180px] divide-y divide-surface-border-subtle overflow-y-auto">
                  {pendingApprovals.map((job) => (
                    <li key={job.id} className="px-3 py-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedJob(job)}
                          className="min-w-0 text-left rounded-lg px-2 py-1 -mx-2 hover:bg-subtle-bg transition-colors"
                          title="Open booking request"
                        >
                          <p className="font-semibold text-heading truncate">
                            {customerLine(job)}
                          </p>
                          <p className="text-xs text-secondary truncate">
                            {getJobBikeDisplayTitle(job)}
                          </p>
                        </button>
                        {job.dropOffDate ? (
                          <span
                            className="text-[11px] font-semibold text-tertiary bg-subtle-bg px-2 py-1 rounded-md"
                            title="Drop-off"
                          >
                            {formatShortDate(job.dropOffDate)}
                          </span>
                        ) : (
                          <span aria-hidden />
                        )}
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAccept(job.id);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 active:bg-emerald-100 dark:active:bg-emerald-900/30 transition-colors touch-manipulation"
                            title="Accept"
                            aria-label={`Accept booking for ${customerLine(job)}`}
                          >
                            <Check className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectClick(job);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 active:bg-red-100 dark:active:bg-red-900/30 transition-colors touch-manipulation"
                            title="Reject"
                            aria-label={`Reject booking for ${customerLine(job)}`}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
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
