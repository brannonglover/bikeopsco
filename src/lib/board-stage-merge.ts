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
