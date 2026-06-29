import type { Job, JobBike } from "@/lib/types";
import { resolveEffectiveBikeType } from "@/lib/bike-type";

/** No live link to a Bike row (deleted from profile clears bikeId, or never linked). */
function isJobBikeUnlinkedFromProfile(jb: JobBike): boolean {
  return !jb.bikeId || !jb.bike;
}

export type JobBikeDisplayParts = {
  make: string;
  model: string | null;
  nickname: string | null;
  imageUrl: string | null;
};

/** Resolved make/model/nickname/image for one job bike row (detail modal, invoice section). */
export function resolveJobBikeDisplayParts(job: Job, jb: JobBike): JobBikeDisplayParts {
  const customerBikes = job.customer?.bikes;
  if (customerBikes?.length === 1 && isJobBikeUnlinkedFromProfile(jb)) {
    const cb = customerBikes[0];
    const nick = jb.nickname?.trim() || cb.nickname?.trim() || null;
    return {
      make: cb.make,
      model: cb.model,
      nickname: nick,
      imageUrl: jb.imageUrl ?? jb.bike?.imageUrl ?? cb.imageUrl ?? null,
    };
  }
  if (jb.bikeId && jb.bike) {
    const nick =
      jb.nickname?.trim() || jb.bike.nickname?.trim() || null;
    return {
      make: jb.bike.make,
      model: jb.bike.model,
      nickname: nick,
      imageUrl: jb.imageUrl ?? jb.bike.imageUrl ?? null,
    };
  }
  return {
    make: jb.make,
    model: jb.model,
    nickname: jb.nickname?.trim() || null,
    imageUrl: jb.imageUrl ?? jb.bike?.imageUrl ?? null,
  };
}

/** Legacy job with no jobBikes rows — synthetic row id `"legacy"`. */
export function resolveLegacyJobBikeDisplayParts(job: Job): JobBikeDisplayParts {
  if (job.customer?.bikes?.length === 1) {
    const cb = job.customer.bikes[0];
    return {
      make: cb.make,
      model: cb.model,
      nickname: cb.nickname?.trim() ?? null,
      imageUrl: cb.imageUrl ?? null,
    };
  }
  return {
    make: job.bikeMake,
    model: job.bikeModel,
    nickname: null,
    imageUrl: null,
  };
}

export function getDisplayPartsForJobBikeRow(job: Job, b: JobBike): JobBikeDisplayParts {
  if (b.id === "legacy") {
    return resolveLegacyJobBikeDisplayParts(job);
  }
  return resolveJobBikeDisplayParts(job, b);
}

/** Bike type line in job detail (matches previous JobBike formatting). */
export function formatBikeTypeDisplayLineForJob(job: Job, b: JobBike): string {
  const dp = getDisplayPartsForJobBikeRow(job, b);
  if (b.bikeType === "REGULAR") return "Standard bike";
  if (b.bikeType === "E_BIKE") return "E-bike";
  const eff =
    resolveEffectiveBikeType({
      bikeType: b.bikeType,
      make: dp.make,
      model: dp.model,
      bikeId: b.bikeId,
      bike: b.bike,
    }) === "E_BIKE"
      ? "E-bike"
      : "Standard bike";
  return `${eff} · auto`;
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
/** Primary bike row on the job — active working bike, else first by sort order. */
export function getPrimaryJobBikeRow(job: Job): JobBike | null {
  const rows = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length === 0) return null;
  if (job.workingOnJobBikeId != null) {
    return rows.find((b) => b.id === job.workingOnJobBikeId) ?? rows[0];
  }
  return rows[0];
}

/** Primary bike row for card imagery — active working bike, else first by sort order. */
export function getPrimaryJobBikeDisplayParts(job: Job): JobBikeDisplayParts {
  const active = getPrimaryJobBikeRow(job);
  if (!active) {
    return resolveLegacyJobBikeDisplayParts(job);
  }
  return getDisplayPartsForJobBikeRow(job, active);
}

/** Short service line for job cards (first two services). */
export function getJobServiceSummary(job: Job): string | null {
  const names = (job.jobServices ?? [])
    .map((s) => s.service?.name ?? s.customServiceName?.trim() ?? null)
    .filter((n): n is string => !!n);
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

export function getJobBikeDisplayTitle(job: Job): string {
  const rows = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  if (rows.length === 0) {
    if (job.bikeMake === "Multiple") {
      return `Multiple - ${job.bikeModel}`.trim();
    }
    const leg = resolveLegacyJobBikeDisplayParts(job);
    return [leg.make, leg.model].filter(Boolean).join(" ");
  }
  if (rows.length === 1) {
    const dp = resolveJobBikeDisplayParts(job, rows[0]);
    return [dp.make, dp.model].filter(Boolean).join(" ");
  }
  return `Multiple - ${rows.length} bikes`;
}

/** Bike line on job board cards — nickname for a single bike, aggregate label when several. */
export function getJobCardBikeTitle(job: Job): string {
  const rows = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length > 1 || (rows.length === 0 && job.bikeMake === "Multiple")) {
    return getJobBikeDisplayTitle(job);
  }
  const dp = getPrimaryJobBikeDisplayParts(job);
  return (
    dp.nickname?.trim() ||
    [dp.make, dp.model].filter(Boolean).join(" ") ||
    getJobBikeDisplayTitle(job)
  );
}
