import "server-only";

import type {
  BikeComponentRecordKind,
  ComponentConfirmation,
  ComponentReplacementState,
  Prisma,
  Stage,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { RepairHistoryConflictError } from "@/lib/job-bike-replacement";

/**
 * The customer's bike record of what's actually fitted (BikeInstalledComponent),
 * kept apart from the catalog's factory spec.
 *
 * A job's part notes (JobBikeComponentOverride) become the bike's record only
 * when the work is done: the bike is marked done, or the job reaches Bike
 * ready / Completed — and the job isn't cancelled or still awaiting approval.
 * Only two kinds of note count:
 *   - a replacement the mechanic marked INSTALLED (not one merely planned,
 *     quoted or ordered), and
 *   - a part the mechanic saw already on the bike that differs from factory.
 * If the job later stops qualifying (cancelled, bike un-marked done, note
 * changed back), the record it made is withdrawn. reconcileInstalledComponents
 * makes the bike record match those rules, and is safe to call any time.
 */

const WORK_DONE_STAGES: Stage[] = ["BIKE_READY", "COMPLETED"];
const NEVER_RECORD_STAGES: Stage[] = ["CANCELLED", "PENDING_APPROVAL"];

export type InstallRecordInput = {
  jobStage: Stage;
  /** The job bike is linked to a customer bike (walk-ins aren't). */
  profileBikeId: string | null;
  jobBikeCompletedAt: Date | null;
  confirmation: ComponentConfirmation;
  customValue: string | null;
  replacementState: ComponentReplacementState;
  replacementValue: string | null;
};

export type InstallRecord = { kind: BikeComponentRecordKind; value: string } | null;

/** What this note should put on the customer's bike record right now, if anything. Pure. */
export function desiredInstallRecord(input: InstallRecordInput): InstallRecord {
  if (!input.profileBikeId) return null;
  if (NEVER_RECORD_STAGES.includes(input.jobStage)) return null;
  const workDone = input.jobBikeCompletedAt != null || WORK_DONE_STAGES.includes(input.jobStage);
  if (!workDone) return null;

  const replacement = input.replacementValue?.trim();
  if (input.replacementState === "INSTALLED" && replacement) {
    return { kind: "INSTALLED", value: replacement };
  }
  const observed = input.customValue?.trim();
  if (input.confirmation === "CUSTOMIZED" && observed) {
    return { kind: "OBSERVED", value: observed };
  }
  return null;
}

/**
 * Bring every customer bike record made from this job in line with the rules
 * above: add what newly qualifies, update what changed, withdraw what no
 * longer qualifies. Returns counts for logging and tests.
 */
export async function reconcileInstalledComponents(
  jobId: string
): Promise<{ added: number; updated: number; withdrawn: number }> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      shopId: true,
      stage: true,
      completedAt: true,
      jobBikes: {
        select: {
          id: true,
          bikeId: true,
          completedAt: true,
          componentOverrides: true,
        },
      },
    },
  });
  const counts = { added: 0, updated: 0, withdrawn: 0 };
  if (!job) return counts;

  const overrides = job.jobBikes.flatMap((jb) => jb.componentOverrides.map((o) => ({ jb, o })));
  const existing = await prisma.bikeInstalledComponent.findMany({
    where: { OR: [{ jobId: job.id }, { overrideId: { in: overrides.map(({ o }) => o.id) } }] },
  });
  const byOverride = new Map(existing.map((r) => [r.overrideId, r]));
  const seen = new Set<string>();

  for (const { jb, o } of overrides) {
    const want = desiredInstallRecord({
      jobStage: job.stage,
      profileBikeId: jb.bikeId,
      jobBikeCompletedAt: jb.completedAt,
      confirmation: o.confirmation,
      customValue: o.customValue,
      replacementState: o.replacementState,
      replacementValue: o.replacementValue,
    });
    const have = byOverride.get(o.id);
    seen.add(o.id);

    if (!want) {
      if (have) {
        await prisma.bikeInstalledComponent.delete({ where: { id: have.id } });
        counts.withdrawn += 1;
      }
      continue;
    }

    const data = {
      shopId: job.shopId,
      bikeId: jb.bikeId!,
      slot: o.slot,
      value: want.value,
      kind: want.kind,
      notes: o.notes,
      jobId: job.id,
      jobBikeId: jb.id,
      confirmedBy: o.updatedBy,
    };
    if (!have) {
      await prisma.bikeInstalledComponent.create({
        data: {
          ...data,
          overrideId: o.id,
          // When the work was confirmed done.
          recordedAt: o.replacementInstalledAt ?? jb.completedAt ?? job.completedAt ?? new Date(),
        },
      });
      counts.added += 1;
    } else if (
      have.value !== data.value ||
      have.kind !== data.kind ||
      have.bikeId !== data.bikeId ||
      have.notes !== data.notes
    ) {
      await prisma.bikeInstalledComponent.update({ where: { id: have.id }, data });
      counts.updated += 1;
    }
  }

  // Records from this job whose note no longer exists (bike removed from the
  // job, note deleted) are withdrawn too.
  for (const r of existing) {
    if (r.jobId === job.id && !seen.has(r.overrideId)) {
      await prisma.bikeInstalledComponent.delete({ where: { id: r.id } });
      counts.withdrawn += 1;
    }
  }
  return counts;
}

/** Never let a record update fail the request that triggered it. */
export async function reconcileInstalledComponentsSafely(jobId: string): Promise<void> {
  try {
    await reconcileInstalledComponents(jobId);
  } catch (error) {
    console.error("[installed-components] reconcile failed:", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type InstalledPart = {
  slot: string;
  value: string;
  kind: BikeComponentRecordKind;
  recordedAt: string;
  jobId: string | null;
  confirmedBy: string | null;
  notes: string | null;
};

/**
 * What's on a customer's bike now, per slot (newest record wins), plus each
 * slot's full history newest first.
 */
export async function installedPartsForBike(
  bikeId: string
): Promise<{ current: Record<string, InstalledPart>; history: Record<string, InstalledPart[]> }> {
  const rows = await prisma.bikeInstalledComponent.findMany({
    where: { bikeId },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
  });
  const history: Record<string, InstalledPart[]> = {};
  for (const r of rows) {
    (history[r.slot] ??= []).push({
      slot: r.slot,
      value: r.value,
      kind: r.kind,
      recordedAt: r.recordedAt.toISOString(),
      jobId: r.jobId,
      confirmedBy: r.confirmedBy,
      notes: r.notes,
    });
  }
  const current: Record<string, InstalledPart> = {};
  for (const [slot, list] of Object.entries(history)) current[slot] = list[0];
  return { current, history };
}

/**
 * Refuse an operation that would delete or orphan repair history: throws
 * RepairHistoryConflictError (→ 409 with `message`) if any recorded part
 * matches `where`. Run it in the same transaction as the delete.
 */
export async function assertNoRepairHistory(
  tx: Pick<Prisma.TransactionClient, "bikeInstalledComponent">,
  where: Prisma.BikeInstalledComponentWhereInput,
  message: string
): Promise<void> {
  const count = await tx.bikeInstalledComponent.count({ where });
  if (count > 0) throw new RepairHistoryConflictError(message, count);
}

/**
 * The explicit override that deletes a customer or bike *with* its repair
 * history (e.g. a privacy request). Any staff member of the owning shop may
 * use it — the app has no roles — but only after the normal shop-scoped
 * ownership check, only with a written reason, and every use is logged.
 */
export function readRepairHistoryOverride(
  searchParams: URLSearchParams
): { confirmed: false } | { confirmed: true; reason: string } | { error: string } {
  if (searchParams.get("confirmRepairHistoryDeletion") !== "true") return { confirmed: false };
  const reason = searchParams.get("reason")?.trim() ?? "";
  if (reason.length < 3) {
    return { error: "Say why the repair history is being deleted (reason=…)." };
  }
  return { confirmed: true, reason: reason.slice(0, 500) };
}

/** Audit line for an override deletion. Structured so log search can find every one. */
export function logRepairHistoryDeletion(entry: {
  shopId: string;
  userId: string;
  entity: "customer" | "bike";
  entityId: string;
  recordCount: number;
  reason: string;
}): void {
  console.warn("[audit] repair_history_deleted", JSON.stringify({ ...entry, at: new Date().toISOString() }));
}
