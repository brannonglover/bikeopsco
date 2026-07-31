import type { Job, Stage } from "@/lib/types";

/** Main board column order — used for display / docs; ranking uses {@link boardStageRank}. */
export const BOARD_STAGE_FLOW: Stage[] = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

/** Working / waiting columns toggle sideways — not a strict forward progression. */
const IN_PROGRESS_STAGES = new Set<Stage>([
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
]);

function boardStageRank(stage: Stage): number {
  if (stage === "BOOKED_IN") return 0;
  if (stage === "RECEIVED") return 1;
  if (IN_PROGRESS_STAGES.has(stage)) return 2;
  if (stage === "BIKE_READY") return 3;
  if (stage === "COMPLETED") return 4;
  return -1;
}

/**
 * When the board already shows a later column than an incoming payload (optimistic drag
 * or a GET that started before the PATCH), keep the forward stage on the board job.
 *
 * Waiting on parts/customer are peers of Working on — moving Waiting → Working must not
 * be treated as a regression (that blocked app→web sync and snapped local resumes back).
 */
export function keepForwardBoardStage(live: Job, incoming: Job): Job {
  if (live.stage === incoming.stage) return incoming;

  const liveRank = boardStageRank(live.stage);
  const incomingRank = boardStageRank(incoming.stage);

  if (
    liveRank !== -1 &&
    incomingRank !== -1 &&
    liveRank === incomingRank &&
    IN_PROGRESS_STAGES.has(live.stage) &&
    IN_PROGRESS_STAGES.has(incoming.stage)
  ) {
    // Protect optimistic Working against a stale Waiting poll (equal updatedAt).
    if (
      live.stage === "WORKING_ON" &&
      (incoming.stage === "WAITING_ON_PARTS" ||
        incoming.stage === "WAITING_ON_CUSTOMER")
    ) {
      return {
        ...incoming,
        stage: live.stage,
        completedAt: live.completedAt ?? incoming.completedAt,
        workingOnJobBikeId:
          live.workingOnJobBikeId ?? incoming.workingOnJobBikeId,
      };
    }
    return incoming;
  }

  if (liveRank === -1 || incomingRank === -1 || liveRank <= incomingRank) {
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
 *
 * Newer updatedAt always wins for stage — local in-flight board drags are re-applied via
 * pendingBoardMoves after merge, so we must not block Waiting→Working from other clients.
 */
export function mergeBoardJob(live: Job, incoming: Job): Job {
  const liveMs = parseJobUpdatedAtMs(live);
  const incomingMs = parseJobUpdatedAtMs(incoming);

  if (liveMs !== null && incomingMs !== null) {
    if (incomingMs > liveMs) {
      return incoming;
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
