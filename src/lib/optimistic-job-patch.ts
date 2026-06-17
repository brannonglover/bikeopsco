import type { DeliveryType, Job, Stage } from "@/lib/types";

/** Match PATCH semantics so UI does not snap when server JSON arrives. */
export function withOptimisticStageChange(job: Job, newStage: Stage): Job {
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

export function applyOptimisticWorkingOnToggle(job: Job, bikeId: string): Job {
  const nextId = job.workingOnJobBikeId === bikeId ? null : bikeId;
  let next: Job = { ...job, workingOnJobBikeId: nextId };
  if (nextId && job.stage !== "WORKING_ON") {
    next = withOptimisticStageChange(next, "WORKING_ON");
    next = { ...next, workingOnJobBikeId: nextId };
  }
  return next;
}

export function applyOptimisticCompleteBike(
  job: Job,
  bikeId: string,
  undo: boolean
): Job {
  const now = new Date().toISOString();
  const jobBikes = (job.jobBikes ?? []).map((b) => {
    if (b.id !== bikeId) return b;
    if (undo) return { ...b, completedAt: null };
    return { ...b, completedAt: now, waitingOnPartsAt: null };
  });
  let next: Job = { ...job, jobBikes };
  if (!undo && job.workingOnJobBikeId === bikeId) {
    next = { ...next, workingOnJobBikeId: null };
  }
  return next;
}

export function applyOptimisticWaitForParts(job: Job, bikeId: string): Job {
  const now = new Date().toISOString();
  const jobBikes = (job.jobBikes ?? []).map((b) =>
    b.id === bikeId ? { ...b, waitingOnPartsAt: now } : b
  );
  let next = withOptimisticStageChange(
    { ...job, jobBikes },
    "WAITING_ON_PARTS"
  );
  if (job.workingOnJobBikeId === bikeId) {
    next = { ...next, workingOnJobBikeId: null };
  }
  return next;
}

export function applyOptimisticResumeWork(job: Job, bikeId: string): Job {
  const jobBikes = (job.jobBikes ?? []).map((b) =>
    b.id === bikeId ? { ...b, waitingOnPartsAt: null } : b
  );
  const next = withOptimisticStageChange(
    { ...job, jobBikes },
    "WORKING_ON"
  );
  return { ...next, workingOnJobBikeId: bikeId };
}

export function applyOptimisticUnwaitOnly(job: Job, bikeId: string): Job {
  const jobBikes = (job.jobBikes ?? []).map((b) =>
    b.id === bikeId ? { ...b, waitingOnPartsAt: null } : b
  );
  if (job.stage !== "WORKING_ON") {
    return withOptimisticStageChange({ ...job, jobBikes }, "WORKING_ON");
  }
  return { ...job, jobBikes };
}

export function applyOptimisticDeliveryType(
  job: Job,
  deliveryType: DeliveryType,
  collectionAddress?: string | null
): Job {
  const next: Job = { ...job, deliveryType };
  if (collectionAddress !== undefined) {
    next.collectionAddress = collectionAddress;
  } else if (deliveryType === "DROP_OFF_AT_SHOP") {
    next.collectionAddress = null;
  }
  return next;
}
