import "server-only";

import type { JobBikeComponentOverride } from "@prisma/client";
import type { CatalogLookup } from "../../bike-catalog/generated/client";
import { prisma } from "@/lib/db";
import {
  fetchSpecsForJobBike,
  isCatalogConfigured,
  type BikeSpecsPayload,
  type SpecsResult,
} from "@/lib/bike-catalog-client";
import { lineupFromRow, lookupRowForBike, webLookupStateForJobBike } from "@/lib/bike-catalog-lookup";
import { installedPartsForBike, type InstalledPart } from "@/lib/bike-installed-components";
import {
  BIKE_BUILD_SELECT,
  confirmBuildForJobBike,
  confirmedBuildForJobBike,
  rememberedBuildId,
  staffDisplayName,
  type BikeBuildFields,
} from "@/lib/customer-bike-build";

/**
 * The Parts tab. Three things kept apart:
 *  - factory spec: what the catalog says this build came with (shared, never
 *    edited from a job);
 *  - on this bike: what completed jobs recorded as fitted (customer's bike);
 *  - this job: what the mechanic saw and is replacing on this visit.
 *
 * Each read is a round trip to the database, so the tab reads everything that
 * depends only on the job bike (this job's notes, the bike's installed parts,
 * the lineup search) while the catalog is consulted, and reuses rows it
 * already has instead of reading them again.
 */

export type PartsTabResponse = { httpStatus: number; body: Record<string, unknown> };

const JOB_BIKE_FIELDS = {
  id: true,
  jobId: true,
  bikeId: true,
  make: true,
  model: true,
  year: true,
  catalogBikeId: true,
  catalogMatchedAt: true,
  catalogLookupAt: true,
} as const;

type JobBikeRow = {
  id: string;
  jobId: string;
  bikeId: string | null;
  make: string;
  model: string | null;
  year: number | null;
  catalogBikeId: string | null;
  catalogMatchedAt: Date | null;
  catalogLookupAt: Date | null;
};

type OverrideView = Pick<
  JobBikeComponentOverride,
  "confirmation" | "customValue" | "notes" | "replacementState" | "replacementValue" | "updatedBy"
> & { replacementInstalledAt: string | null };

function toOverrideView(o: JobBikeComponentOverride): OverrideView {
  return {
    confirmation: o.confirmation,
    customValue: o.customValue,
    notes: o.notes,
    replacementState: o.replacementState,
    replacementValue: o.replacementValue,
    updatedBy: o.updatedBy,
    replacementInstalledAt: o.replacementInstalledAt?.toISOString() ?? null,
  };
}

/** Attach this job's notes and the bike's installed record to each factory part. */
function decorateSpecs(
  specs: BikeSpecsPayload,
  overrides: JobBikeComponentOverride[],
  installed: Record<string, InstalledPart>
) {
  const bySlot = new Map(overrides.map((o) => [o.slot, o]));
  return {
    ...specs,
    groups: specs.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const o = bySlot.get(item.slot);
        return {
          ...item,
          // Kept for older clients: the tab's own confirmation state.
          confirmation: o?.confirmation ?? ("UNREVIEWED" as const),
          job: o ? toOverrideView(o) : null,
          installed: installed[item.slot] ?? null,
        };
      }),
    })),
  };
}

/** The job bike with its customer bike's confirmed build, in one read. */
async function loadJobBike(
  jobBikeId: string,
  jobId: string,
  shopId: string
): Promise<{ jobBike: JobBikeRow; bike: BikeBuildFields | null } | null> {
  const row = await prisma.jobBike.findFirst({
    where: { id: jobBikeId, jobId, shopId },
    select: { ...JOB_BIKE_FIELDS, bike: { select: BIKE_BUILD_SELECT } },
  });
  if (!row) return null;
  const { bike, ...jobBike } = row;
  return { jobBike, bike };
}

async function updateJobBike(
  id: string,
  data: { catalogBikeId: string | null; catalogMatchedAt: Date | null; catalogLookupAt?: Date }
): Promise<JobBikeRow> {
  return prisma.jobBike.update({ where: { id }, data, select: JOB_BIKE_FIELDS });
}

/** Reads that depend only on the job bike, started before the catalog is consulted. */
type SideReads = {
  overrides: Promise<JobBikeComponentOverride[]>;
  installed: Promise<{ current: Record<string, InstalledPart>; history: Record<string, InstalledPart[]> }>;
  /** The lineup search's row; `ok: false` when it couldn't be read (it never blocks the tab). */
  lookupRow: Promise<{ ok: boolean; row: CatalogLookup | null }>;
};

function startSideReads(jobBike: JobBikeRow, shopId: string): SideReads {
  const reads: SideReads = {
    overrides: prisma.jobBikeComponentOverride.findMany({ where: { jobBikeId: jobBike.id, shopId } }),
    installed: jobBike.bikeId
      ? installedPartsForBike(jobBike.bikeId)
      : Promise.resolve({ current: {}, history: {} }),
    lookupRow: lookupRowForBike(jobBike).then(
      (row) => ({ ok: true, row }),
      () => ({ ok: false, row: null })
    ),
  };
  // Awaited in respond(). An early return (404, 409) must not leave a
  // rejection unhandled.
  reads.overrides.catch(() => {});
  reads.installed.catch(() => {});
  return reads;
}

/** Whether the linked build is one a mechanic confirmed for this customer's bike. */
function buildStatus(jobBike: JobBikeRow, bike: BikeBuildFields | null) {
  if (!jobBike.bikeId) return { canRemember: false, confirmed: false, confirmedAt: null, confirmedBy: null };
  const confirmed = Boolean(
    jobBike.catalogBikeId && bike?.catalogConfirmedAt && bike.catalogBikeId === jobBike.catalogBikeId
  );
  return {
    canRemember: true,
    confirmed,
    confirmedAt: confirmed ? bike!.catalogConfirmedAt!.toISOString() : null,
    confirmedBy: confirmed ? bike!.catalogConfirmedBy : null,
  };
}

async function respond(
  jobBike: JobBikeRow,
  bike: BikeBuildFields | null,
  reads: SideReads,
  result: SpecsResult | null,
  extra: { status?: string; httpStatus?: number; lookup?: unknown } = {}
): Promise<PartsTabResponse> {
  const [overrides, installed, lookupRow] = await Promise.all([reads.overrides, reads.installed, reads.lookupRow]);
  const base = {
    configured: isCatalogConfigured(),
    jobBikeId: jobBike.id,
    catalogBikeId: jobBike.catalogBikeId,
    fetchedAt: jobBike.catalogMatchedAt?.toISOString() ?? null,
    lineup: lineupFromRow(lookupRow.row),
    build: buildStatus(jobBike, bike),
    /** On the customer's bike now, per slot — from completed jobs. */
    installed: installed.current,
    installedHistory: installed.history,
    /** This job's notes for slots the factory sheet doesn't list (or with no sheet). */
    jobNotes: overrides.map((o) => ({ slot: o.slot, ...toOverrideView(o) })),
  };
  if (!result) {
    return { httpStatus: 200, body: { ...base, status: extra.status ?? "not_fetched", specs: null, overrides: [] } };
  }
  if (!result.ok) {
    return {
      httpStatus: extra.httpStatus ?? 200,
      body: {
        ...base,
        status: result.reason,
        specs: null,
        error: result.message ?? "Could not fetch bike specs",
        candidates: result.candidates ?? [],
        lookup: extra.lookup ?? null,
        overrides: [],
      },
    };
  }
  return {
    httpStatus: 200,
    body: {
      ...base,
      status: extra.status ?? "cached",
      catalogBikeId: result.catalogBikeId,
      specs: decorateSpecs(result.specs, overrides, installed.current),
      overrides,
    },
  };
}

const NOT_FOUND: PartsTabResponse = { httpStatus: 404, body: { error: "Job bike not found" } };

/**
 * A database that can't be reached is an error the tab shows as one, never a
 * "no match": nothing is written and no lookup is started after it.
 */
async function explicitDatabaseErrors(
  jobBikeId: string,
  run: () => Promise<PartsTabResponse>
): Promise<PartsTabResponse> {
  try {
    return await run();
  } catch (error) {
    console.error("[parts-tab] database error:", {
      jobBikeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      httpStatus: 503,
      body: {
        jobBikeId,
        status: "unavailable",
        specs: null,
        error: "Parts couldn’t be loaded right now. Try again in a moment.",
      },
    };
  }
}

/** GET: show what's linked, without changing anything. */
export async function readPartsTab(input: {
  jobId: string;
  jobBikeId: string;
  shopId: string;
}): Promise<PartsTabResponse> {
  return explicitDatabaseErrors(input.jobBikeId, async () => {
    const loaded = await loadJobBike(input.jobBikeId, input.jobId, input.shopId);
    if (!loaded) return NOT_FOUND;
    const { jobBike, bike } = loaded;
    const reads = startSideReads(jobBike, input.shopId);
    if (!jobBike.catalogBikeId) return respond(jobBike, bike, reads, null);
    const result = await fetchSpecsForJobBike(jobBike.make, jobBike.model, jobBike.year, jobBike.catalogBikeId);
    const unavailable = !result.ok && result.reason === "catalog_unavailable";
    return respond(jobBike, bike, reads, result, unavailable ? { httpStatus: 503 } : {});
  });
}

/** POST: load the tab, matching and linking a build (or confirming one the mechanic picked). */
export async function loadPartsTab(input: {
  jobId: string;
  jobBikeId: string;
  shopId: string;
  userId: string | null;
  refresh?: boolean;
  /** The mechanic picked this build from the possible matches. */
  catalogBikeId?: string;
  /** The mechanic confirmed the automatically matched build is this bike. */
  confirm?: boolean;
}): Promise<PartsTabResponse> {
  return explicitDatabaseErrors(input.jobBikeId, async () => {
    const loaded = await loadJobBike(input.jobBikeId, input.jobId, input.shopId);
    if (!loaded) return NOT_FOUND;
    let { jobBike, bike } = loaded;

    if (!isCatalogConfigured()) {
      return {
        httpStatus: 503,
        body: {
          configured: false,
          jobBikeId: jobBike.id,
          status: "not_configured" as const,
          error: "Bike catalog database is not configured",
        },
      };
    }

    const reads = startSideReads(jobBike, input.shopId);

    // The mechanic says which build this is: link it and remember it on the
    // customer's bike for every later visit.
    const confirmId = input.catalogBikeId ?? (input.confirm ? jobBike.catalogBikeId : null);
    if (confirmId) {
      const [result, confirmedBy] = await Promise.all([
        fetchSpecsForJobBike(jobBike.make, jobBike.model, jobBike.year, confirmId),
        staffDisplayName(input.userId),
      ]);
      if (!result.ok && result.reason === "catalog_unavailable") {
        return respond(jobBike, bike, reads, result, { httpStatus: 503 });
      }
      if (!result.ok || result.catalogBikeId !== confirmId) {
        return { httpStatus: 409, body: { error: "That build doesn't fit this bike's year" } };
      }
      const confirmed = await confirmBuildForJobBike({
        jobBikeId: jobBike.id,
        catalogBikeId: confirmId,
        confirmedBy,
      });
      jobBike = { ...jobBike, ...confirmed.jobBike };
      bike = confirmed.bike ?? bike;
      return respond(jobBike, bike, reads, result, { status: "fetched" });
    }

    // Not linked yet, but a mechanic confirmed this customer's bike on an
    // earlier visit — use that build. Its years are checked against the
    // catalog row by fetchSpecsForJobBike, which matches afresh if they no
    // longer fit.
    const remembered = jobBike.catalogBikeId ? null : rememberedBuildId(jobBike, bike);
    if (remembered && input.refresh) {
      // Refresh still records the remembered build first, then re-matches.
      if (await confirmedBuildForJobBike(jobBike, bike)) {
        jobBike = await updateJobBike(jobBike.id, {
          catalogBikeId: remembered,
          catalogMatchedAt: new Date(),
          catalogLookupAt: new Date(),
        });
      }
    }

    const existingId = input.refresh ? null : (jobBike.catalogBikeId ?? remembered);
    const result = await fetchSpecsForJobBike(jobBike.make, jobBike.model, jobBike.year, existingId);

    if (!result.ok) {
      if (result.reason === "catalog_unavailable") {
        // Nothing was learned about this bike: keep its link, start no lookup.
        return respond(jobBike, bike, reads, result, { httpStatus: 503 });
      }
      // Clear a previously sticky wrong-year match so Refresh keeps failing closed.
      if (jobBike.catalogBikeId) {
        jobBike = await updateJobBike(jobBike.id, { catalogBikeId: null, catalogMatchedAt: null });
      }
      // Not in the catalog yet: say where the web lookup stands (starting one if
      // it never ran) so the tab can wait for it instead of dead-ending. When
      // the lookup row couldn't be read, nothing is started.
      const lookupRow = await reads.lookupRow;
      const lookup =
        result.reason === "not_configured" || !lookupRow.ok
          ? null
          : await webLookupStateForJobBike(jobBike, { reason: result.reason }, { row: lookupRow.row }).catch(
              () => null
            );
      return respond(jobBike, bike, reads, result, {
        lookup,
        httpStatus: result.reason === "not_configured" ? 503 : 404,
      });
    }

    if (result.catalogBikeId !== jobBike.catalogBikeId) {
      const usedRemembered = result.catalogBikeId === remembered;
      jobBike = await updateJobBike(jobBike.id, {
        catalogBikeId: result.catalogBikeId,
        catalogMatchedAt: new Date(),
        ...(usedRemembered ? { catalogLookupAt: new Date() } : {}),
      });
      return respond(jobBike, bike, reads, result, { status: usedRemembered ? "cached" : "fetched" });
    }
    return respond(jobBike, bike, reads, result, { status: "cached" });
  });
}
