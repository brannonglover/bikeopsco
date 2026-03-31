import type { Job, JobBike } from "@/lib/types";

/** Make/model for a job bike row, preferring the linked customer bike when present. */
function effectiveJobBikeMakeModel(jb: JobBike): { make: string; model: string } {
  if (jb.bikeId && jb.bike) {
    return { make: jb.bike.make, model: jb.bike.model };
  }
  return { make: jb.make, model: jb.model };
}

/** No live link to a Bike row (deleted from profile clears bikeId, or never linked). */
function isJobBikeUnlinkedFromProfile(jb: JobBike): boolean {
  return !jb.bikeId || !jb.bike;
}

/**
 * Title for job cards and headers. Uses linked customer bike data when the job has
 * jobBikes with bikeId + bike, so profile edits show on the board without resyncing
 * denormalized job.bikeMake / job.bikeModel.
 *
 * When a profile bike is removed, JobBike loses bikeId (SetNull) but snapshots stay
 * stale; if the customer still has exactly one bike, we use that as the display source
 * so remove-and-replace flows match the board after refresh.
 */
export function getJobBikeDisplayTitle(job: Job): string {
  const rows = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const customerBikes = job.customer?.bikes;

  if (rows.length === 0) {
    return job.bikeMake === "Multiple"
      ? `${job.bikeModel}`
      : `${job.bikeMake} ${job.bikeModel}`.trim();
  }
  if (rows.length === 1) {
    const row = rows[0];
    if (
      customerBikes?.length === 1 &&
      isJobBikeUnlinkedFromProfile(row)
    ) {
      const b = customerBikes[0];
      return `${b.make} ${b.model}`.trim();
    }
    const { make, model } = effectiveJobBikeMakeModel(row);
    return `${make} ${model}`.trim();
  }
  if (job.bikeMake === "Multiple") {
    return job.bikeModel;
  }
  return `${job.bikeMake} ${job.bikeModel}`.trim();
}
