import type { Job, JobBike } from "@/lib/types";

/** Make/model for a job bike row, preferring the linked customer bike when present. */
function effectiveJobBikeMakeModel(jb: JobBike): { make: string; model: string } {
  if (jb.bikeId && jb.bike) {
    return { make: jb.bike.make, model: jb.bike.model };
  }
  return { make: jb.make, model: jb.model };
}

/**
 * Title for job cards and headers. Uses linked customer bike data when the job has
 * jobBikes with bikeId + bike, so profile edits show on the board without resyncing
 * denormalized job.bikeMake / job.bikeModel.
 */
export function getJobBikeDisplayTitle(job: Job): string {
  const rows = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length === 0) {
    return job.bikeMake === "Multiple"
      ? `${job.bikeModel}`
      : `${job.bikeMake} ${job.bikeModel}`.trim();
  }
  if (rows.length === 1) {
    const { make, model } = effectiveJobBikeMakeModel(rows[0]);
    return `${make} ${model}`.trim();
  }
  if (job.bikeMake === "Multiple") {
    return job.bikeModel;
  }
  return `${job.bikeMake} ${job.bikeModel}`.trim();
}
