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
import {
  mergeBoardJob,
  mergeBoardJobsFromFetch,
} from "@/lib/board-stage-merge";
import { mergeJobPreservingInvoiceDetails } from "@/lib/job-invoice-merge";
import { withOptimisticStageChange } from "@/lib/optimistic-job-patch";

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

/** Main board columns — pending approvals live above the columns; cancelled jobs are on Archive. */
const DISPLAY_STAGES: Stage[] = STAGES.filter(
  (s) => s !== "CANCELLED" && s !== "PENDING_APPROVAL"
);

type BoardFilterKey = "all" | "in_progress" | "waiting" | "ready" | "completed";

const BOARD_FILTERS: {
  key: BoardFilterKey;
  label: string;
  stages: Stage[] | null;
}[] = [
  { key: "all", label: "All", stages: null },
  {
    key: "in_progress",
    label: "In progress",
    stages: ["BOOKED_IN", "RECEIVED", "WORKING_ON"],
  },
  {
    key: "waiting",
    label: "Waiting",
    stages: ["WAITING_ON_CUSTOMER", "WAITING_ON_PARTS"],
  },
  { key: "ready", label: "Ready", stages: ["BIKE_READY"] },
  { key: "completed", label: "Completed", stages: ["COMPLETED"] },
];

type ColumnSortUpdate = { id: string; columnSortOrder: number };
type PendingBoardMove = {
  stage: Stage;
  sortOrders: Map<string, number>;
};

/** Match PATCH semantics so the card does not “snap” again when the server JSON arrives. */
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
  const [newJobModalOpen, setNewJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [rejectingJob, setRejectingJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const dismissDateToastJobIdRef = useRef<string | null>(null);
  const pendingBoardMovesRef = useRef<Map<string, PendingBoardMove>>(new Map());
  /** Serialize PATCH /api/jobs/[id] per job so rapid drags don't overlap transactions. */
  const jobPatchQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  /** Only the latest drag for a job may revert optimistic UI on failure. */
  const jobPatchGenerationRef = useRef<Map<string, number>>(new Map());
  /** Job IDs for which board actions should not send customer email/SMS. */
  const [jobsSkippingCustomerNotify, setJobsSkippingCustomerNotify] = useState<
    Set<string>
  >(() => new Set());
  const [boardFilter, setBoardFilter] = useState<BoardFilterKey>("all");
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

  const applyPendingBoardMoves = useCallback((incoming: Job[]): Job[] => {
    const pending = pendingBoardMovesRef.current;
    if (pending.size === 0) return incoming;

    const resolvedIds: string[] = [];
    const resolvedSortIds: string[] = [];
    const next = incoming.map((job) => {
      let patched = job;

      const ownMove = pending.get(job.id);
      if (ownMove) {
        if (job.stage === ownMove.stage) {
          resolvedIds.push(job.id);
        } else {
          patched = withOptimisticStageChange(job, ownMove.stage);
        }
      }

      for (const [moveJobId, move] of pending) {
        const sortOrder = move.sortOrders.get(job.id);
        if (sortOrder === undefined) continue;
        patched = { ...patched, columnSortOrder: sortOrder };
        if (job.id !== moveJobId || job.stage === move.stage) {
          resolvedSortIds.push(`${moveJobId}:${job.id}`);
        }
      }

      return patched;
    });

    for (const id of resolvedIds) {
      pending.delete(id);
    }
    for (const key of resolvedSortIds) {
      const [moveJobId, sortedJobId] = key.split(":");
      pending.get(moveJobId)?.sortOrders.delete(sortedJobId);
    }

    return next;
  }, []);

  const handleJobUpdated = useCallback(
    (updated: Job) => {
      if (updated.archivedAt || updated.stage === "CANCELLED") {
        pendingBoardMovesRef.current.delete(updated.id);
        setSelectedJob(null);
        setJobs((prev) => prev.filter((j) => j.id !== updated.id));
        return;
      }
      const mergeFromUpdate = (current: Job) => {
        const merged = mergeJobPreservingInvoiceDetails(current, updated);
        const ownMove = pendingBoardMovesRef.current.get(updated.id);
        if (ownMove && merged.stage !== ownMove.stage) {
          return withOptimisticStageChange(merged, ownMove.stage);
        }
        return mergeBoardJob(current, merged);
      };
      setSelectedJob((prev) =>
        prev?.id === updated.id ? mergeFromUpdate(prev) : prev
      );
      setJobs((prev) =>
        applyPendingBoardMoves(
          prev.map((j) => (j.id === updated.id ? mergeFromUpdate(j) : j))
        )
      );
    },
    [applyPendingBoardMoves]
  );

  const fetchJobs = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    fetch("/api/jobs?view=board", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load jobs (${res.status})`);
        }
        const data = await res.json();
        const incoming = Array.isArray(data) ? (data as Job[]) : [];
        setJobs((prev) => {
          const next = applyPendingBoardMoves(
            mergeBoardJobsFromFetch(prev, incoming)
          );
          setSelectedJob((sel) => {
            if (!sel) return sel;
            const refreshed = next.find((j) => j.id === sel.id);
            if (!refreshed) return sel;
            return mergeJobPreservingInvoiceDetails(sel, refreshed);
          });
          return next;
        });
      })
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [applyPendingBoardMoves]);

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
    (jobId: string) => {
      const revertSnapshots = new Map<string, Job>();
      setJobs((prev) => {
        const job = prev.find((j) => j.id === jobId);
        if (!job || job.stage === "BOOKED_IN") return prev;
        revertSnapshots.set(jobId, cloneJobForRevert(job));
        return prev.map((j) =>
          j.id === jobId ? withOptimisticStageChange(j, "BOOKED_IN") : j
        );
      });
      setSelectedJob((sel) =>
        sel?.id === jobId ? withOptimisticStageChange(sel, "BOOKED_IN") : sel
      );

      void (async () => {
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
            setSelectedJob((sel) => (sel?.id === jobId ? updated : sel));
          } else {
            const snapshot = revertSnapshots.get(jobId);
            if (snapshot) {
              setJobs((prev) =>
                prev.map((j) => (j.id === jobId ? snapshot : j))
              );
              setSelectedJob((sel) => (sel?.id === jobId ? snapshot : sel));
            }
          }
        } catch (e) {
          console.error("Failed to accept job", e);
          const snapshot = revertSnapshots.get(jobId);
          if (snapshot) {
            setJobs((prev) =>
              prev.map((j) => (j.id === jobId ? snapshot : j))
            );
            setSelectedJob((sel) => (sel?.id === jobId ? snapshot : sel));
          }
        }
      })();
    },
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify]
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
          setJobs((prev) => prev.filter((j) => j.id !== jobId));
          if (selectedJob?.id === jobId) setSelectedJob(null);
        }
      } catch (e) {
        console.error("Failed to reject job", e);
      }
    },
    [features.notifyCustomerEnabled, jobsSkippingCustomerNotify, selectedJob?.id]
  );

  const handleArchiveCompleted = useCallback(async () => {
    const completedIds = jobs
      .filter((j) => j.stage === "COMPLETED")
      .map((j) => j.id);
    if (completedIds.length === 0) return;
    const completedIdSet = new Set(completedIds);
    setArchiving(true);
    flushSync(() => {
      setJobs((prev) => prev.filter((j) => !completedIdSet.has(j.id)));
      if (selectedJob && completedIdSet.has(selectedJob.id)) {
        setSelectedJob(null);
      }
    });
    try {
      const res = await fetch("/api/jobs/archive-completed", { method: "POST" });
      if (!res.ok) {
        fetchJobs({ silent: true });
      }
    } finally {
      setArchiving(false);
    }
  }, [jobs, selectedJob, fetchJobs]);

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

      pendingBoardMovesRef.current.set(jobId, {
        stage: newStage,
        sortOrders: sortMap,
      });

      const revert = () => {
        pendingBoardMovesRef.current.delete(jobId);
        if (revertSnapshots.size === 0) return;
        setJobs((prev) =>
          prev.map((j) => revertSnapshots.get(j.id) ?? j)
        );
        setSelectedJob((sel) =>
          sel?.id === jobId ? revertSnapshots.get(jobId) ?? sel : sel
        );
      };

      const generation =
        (jobPatchGenerationRef.current.get(jobId) ?? 0) + 1;
      jobPatchGenerationRef.current.set(jobId, generation);

      const persistStage = async () => {
        const body: Record<string, unknown> = { stage: newStage };
        if (!features.notifyCustomerEnabled || jobsSkippingCustomerNotify.has(jobId)) {
          body.notifyCustomer = false;
        }

        let res: Response | null = null;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            res = await fetch(`/api/jobs/${jobId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (res.ok || res.status < 500) break;
            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
        } catch (e) {
          console.error("Failed to update job", e);
          if (jobPatchGenerationRef.current.get(jobId) === generation) {
            revert();
          }
          return;
        }

        if (!res) return;

        if (jobPatchGenerationRef.current.get(jobId) !== generation) {
          return;
        }

        if (res.ok) {
          const updated = await res.json();
          pendingBoardMovesRef.current.set(jobId, {
            stage: newStage,
            sortOrders: sortMap,
          });
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
          console.error(
            "Failed to update job stage",
            res.status,
            await res.text().catch(() => "")
          );
          revert();
        }
      };

      const prev = jobPatchQueueRef.current.get(jobId) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(persistStage);
      jobPatchQueueRef.current.set(jobId, next);
      void next.finally(() => {
        if (jobPatchQueueRef.current.get(jobId) === next) {
          jobPatchQueueRef.current.delete(jobId);
        }
      });
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

  const filterCounts = BOARD_FILTERS.reduce(
    (acc, filter) => {
      if (filter.stages === null) {
        acc[filter.key] = jobs.filter((j) =>
          DISPLAY_STAGES.includes(j.stage as Stage)
        ).length;
      } else {
        acc[filter.key] = jobs.filter((j) =>
          filter.stages!.includes(j.stage as Stage)
        ).length;
      }
      return acc;
    },
    {} as Record<BoardFilterKey, number>
  );

  const visibleStages = features.jobBoardFiltersEnabled
    ? DISPLAY_STAGES.filter((stage) => {
        if (boardFilter === "all") return true;
        const activeFilter = BOARD_FILTERS.find((f) => f.key === boardFilter);
        return activeFilter?.stages?.includes(stage) ?? true;
      })
    : DISPLAY_STAGES;

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-3xl bg-job-board p-6 shadow-float ring-1 ring-black/[0.04] dark:!bg-transparent dark:!shadow-none dark:ring-0 text-slate-500 font-medium">
          Loading jobs...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        onJobUpdated={handleJobUpdated}
        onJobDateSaved={(field, jobId) => {
          if (dismissDateToastJobIdRef.current !== jobId) return;
          dismissDateToastJobIdRef.current = null;
          const label =
            field === "pickupDate"
              ? "Pickup date"
              : field === "dropOffDate"
                ? "Drop-off date"
                : field === "collectionReturnWindow"
                  ? "Return window"
                  : "Pickup window";
          showSavedToast(`${label} updated`);
        }}
        onJobDeleted={(jobId) => {
          setSelectedJob(null);
          setJobs((prev) => prev.filter((j) => j.id !== jobId));
        }}
      />
      {savedToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-soft"
          role="status"
        >
          {savedToast}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden rounded-3xl bg-job-board p-5 shadow-float ring-1 ring-black/[0.04] dark:!bg-transparent dark:!shadow-none dark:ring-0 sm:p-6">
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
          <h1 className="text-xl sm:text-2xl font-bold text-heading flex-shrink-0">
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

      {features.jobBoardFiltersEnabled && (
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          {BOARD_FILTERS.map((filter) => {
            const isActive = boardFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setBoardFilter(filter.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors touch-manipulation ${
                  isActive
                    ? "bg-amber-500 text-white shadow-sm"
                    : "bg-subtle-bg text-secondary hover:bg-surface-border/60 hover:text-heading"
                }`}
              >
                {filter.label}
                <span
                  className={`tabular-nums text-xs font-bold ${
                    isActive ? "text-white/90" : "text-tertiary"
                  }`}
                >
                  {filterCounts[filter.key]}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
        <div className="flex min-h-0 flex-1 gap-5 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 w-full">
          {visibleStages.map((stage) => (
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
              onJobUpdated={handleJobUpdated}
            />
          ))}
        </div>

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
    </div>
  );
}
