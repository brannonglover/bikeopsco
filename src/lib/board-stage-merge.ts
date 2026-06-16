import type { Job, Stage } from "@/lib/types";

/** Main board column order — used to keep a drag-ahead stage when a slow fetch returns an older stage. */
export const BOARD_STAGE_FLOW: Stage[] = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

function boardStageIndex(stage: Stage): number {
  return BOARD_STAGE_FLOW.indexOf(stage);
}

/**
 * When the board already shows a later column than an incoming payload (optimistic drag
 * or a GET that started before the PATCH), keep the forward stage on the board job.
 */
export function keepForwardBoardStage(live: Job, incoming: Job): Job {
  if (live.stage === incoming.stage) return incoming;

  const liveIdx = boardStageIndex(live.stage);
  const incomingIdx = boardStageIndex(incoming.stage);
  if (liveIdx === -1 || incomingIdx === -1 || liveIdx <= incomingIdx) {
    return incoming;
  }

  return {
    ...incoming,
    stage: live.stage,
    completedAt: live.completedAt ?? incoming.completedAt,
    workingOnJobBikeId: live.workingOnJobBikeId,
  };
}

function parseJobUpdatedAtMs(job: Job): number | null {
  const ms = Date.parse(job.updatedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Merge a polled/refetched board row into what the client already shows. Stale responses
 * (older updatedAt than a successful PATCH) must not revert stage; equal timestamps still
 * use forward-stage protection for in-flight drags before updatedAt bumps.
 */
export function mergeBoardJob(live: Job, incoming: Job): Job {
  const liveMs = parseJobUpdatedAtMs(live);
  const incomingMs = parseJobUpdatedAtMs(incoming);

  if (liveMs !== null && incomingMs !== null) {
    if (incomingMs > liveMs) {
      // Invoice lines and other non-stage PATCHes bump updatedAt without changing stage.
      // A poll that started before a stage PATCH can therefore look "newer" but still carry
      // an older column — keep a forward stage the board already shows.
      const forward = keepForwardBoardStage(live, incoming);
      return forward.stage !== incoming.stage ? forward : incoming;
    }
    if (incomingMs < liveMs) {
      return {
        ...incoming,
        stage: live.stage,
        completedAt: live.completedAt,
        workingOnJobBikeId: live.workingOnJobBikeId,
        columnSortOrder: live.columnSortOrder ?? incoming.columnSortOrder,
      };
    }
  }

  return keepForwardBoardStage(live, incoming);
}

/** Apply {@link mergeBoardJob} for a full board poll/refetch payload. */
export function mergeBoardJobsFromFetch(previous: Job[], incoming: Job[]): Job[] {
  const prevById = new Map(previous.map((job) => [job.id, job]));
  return incoming.map((job) => {
    const live = prevById.get(job.id);
    return live ? mergeBoardJob(live, job) : job;
  });
}
