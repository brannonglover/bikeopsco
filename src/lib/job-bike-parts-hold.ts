/**
 * Which bike, if any, a job PATCH moves into a parts hold.
 *
 * Bike status drives bike-specific customer notifications; job stage drives board
 * behavior. Kept free of server dependencies so the trigger rule can be exercised on
 * its own — it decides whether a customer gets a message, so it has to be exactly right.
 */
type ExistingJobBike = {
  id: string;
  completedAt: Date | null;
  waitingOnPartsAt: Date | null;
};

/**
 * The bike, if any, that this PATCH moves into a parts hold. Mirrors the two places the
 * transaction stamps `waitingOnPartsAt`: an explicit bike-level hold, and the job-level
 * move into WAITING_ON_PARTS that stamps whichever bike was being worked on.
 *
 * Returns null when the bike was already on hold, so re-sending the same PATCH stays quiet.
 */
export function findBikeEnteringPartsHold({
  existingJob,
  data,
}: {
  existingJob: {
    stage: string;
    workingOnJobBikeId: string | null;
    jobBikes?: ExistingJobBike[] | null;
  };
  data: {
    stage?: string;
    waitForPartsJobBikeId?: string;
    unwaitForPartsJobBikeId?: string;
  };
}): string | null {
  const bikes = existingJob.jobBikes ?? [];
  const isEnteringHold = (bikeId: string | null): boolean => {
    if (!bikeId) return false;
    const bike = bikes.find((b) => b.id === bikeId);
    return Boolean(bike && !bike.completedAt && !bike.waitingOnPartsAt);
  };

  if (data.waitForPartsJobBikeId) {
    return isEnteringHold(data.waitForPartsJobBikeId)
      ? data.waitForPartsJobBikeId
      : null;
  }

  const jobLevelMoveIntoHold =
    data.stage === "WAITING_ON_PARTS" &&
    existingJob.stage !== "WAITING_ON_PARTS" &&
    !data.unwaitForPartsJobBikeId;
  if (jobLevelMoveIntoHold && isEnteringHold(existingJob.workingOnJobBikeId)) {
    return existingJob.workingOnJobBikeId;
  }

  return null;
}
