"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, JobBike } from "@/lib/types";
import type { BikeSpecsPayload, MatchedCatalogBike } from "@/lib/bike-specs";
import { getDisplayPartsForJobBikeRow } from "@/lib/job-display";
import { SLOT_META } from "../../../bike-catalog/lib/slots";

/**
 * The Parts tab keeps three things apart, per part:
 *   Factory      — what the catalog says this build came with (shared reference);
 *   On this bike — what completed jobs recorded as fitted to this customer's bike;
 *   This visit   — what the mechanic sees, plans and fits on this job.
 * Nothing in "This visit" reaches the customer's bike record until the bike is
 * marked done (and never from a cancelled job or a part that's only planned).
 */

type FetchStatus =
  | "idle"
  | "loading"
  | "cached"
  | "fetched"
  | "not_fetched"
  | "not_configured"
  | "no_match"
  | "low_confidence"
  | "ambiguous"
  /** The database or catalog couldn't be read — not the same as "no match". */
  | "unavailable"
  | "error";

type InstalledPart = {
  slot: string;
  value: string;
  kind: "INSTALLED" | "OBSERVED";
  recordedAt: string;
  jobId: string | null;
  confirmedBy: string | null;
  notes: string | null;
};

type JobNote = {
  confirmation: "UNREVIEWED" | "MATCHES_CATALOG" | "CUSTOMIZED";
  customValue: string | null;
  notes: string | null;
  replacementState: "NONE" | "PLANNED" | "INSTALLED";
  replacementValue: string | null;
  replacementInstalledAt: string | null;
  updatedBy: string | null;
};

type SpecItemView = {
  slot: string;
  label: string;
  value: string;
  detail?: string;
  visibility?: string;
  source?: "MANUFACTURER" | "THIRD_PARTY" | "ADMIN" | "APPROXIMATE";
  sourceUrl?: string | null;
  verified?: { at: string; by: string | null; against: string | null } | null;
  fitCritical?: boolean;
  fitNote?: string | null;
  checkBeforeOrdering?: boolean;
  job?: JobNote | null;
  installed?: InstalledPart | null;
};

type BikeSpecsResponse = {
  configured: boolean;
  jobBikeId: string;
  status: string;
  catalogBikeId?: string | null;
  specs?: (Omit<BikeSpecsPayload, "groups"> & {
    groups: Array<{ id: string; title: string; items: SpecItemView[] }>;
  }) | null;
  fetchedAt?: string | null;
  error?: string;
  candidates?: MatchedCatalogBike[];
  /** Where the background web lookup stands when the catalog has no match. */
  lookup?: WebLookupState | null;
  lineup?: { confirmed: boolean; builds: number; sourceUrl: string | null } | null;
  build?: { canRemember: boolean; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null };
  installed?: Record<string, InstalledPart>;
};

type WebLookupState =
  | "searching"
  | "needs_choice"
  | "not_found"
  | "failed"
  | "retrying"
  | "budget"
  | "needs_details";

/** How often to re-check while a web lookup runs, and when to stop waiting. */
const LOOKUP_POLL_MS = 8_000;
const LOOKUP_POLL_LIMIT = 30;

const LOOKUP_MESSAGES: Record<Exclude<WebLookupState, "searching">, string> = {
  needs_choice:
    "We found builds sold under this name but can’t be sure which one this bike is. If one below matches the bike, select it.",
  not_found: "We searched the web and couldn’t find a sourced parts list for this bike.",
  failed: "The web lookup couldn’t find this bike after several tries.",
  retrying: "The web lookup hit a problem and will try again automatically.",
  budget: "Today’s web lookup limit has been reached. It will look this bike up tomorrow.",
  needs_details: "Add the model and year in Details and we’ll look this bike up automatically.",
};

const SPEC_STATUS_BADGES: Record<
  MatchedCatalogBike["specStatus"],
  { label: string; hint: string; className: string }
> = {
  VERIFIED: {
    label: "Verified build",
    hint: "Bike Ops confirmed the model, trim and years. Parts are verified one by one — see each part.",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  SOURCED: {
    label: "From web sources — not yet verified",
    hint: "Each part links to the page it came from.",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  },
  APPROXIMATE: {
    label: "Approximate — typical for this generation",
    hint: "Not specific to this bike’s trim. Don’t order parts from this alone.",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
};

const SOURCE_LABELS: Record<NonNullable<SpecItemView["source"]>, string> = {
  MANUFACTURER: "Manufacturer spec",
  THIRD_PARTY: "Third-party source",
  ADMIN: "Entered by Bike Ops",
  APPROXIMATE: "Approximate",
};

const BADGE = "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

function bikeRowLabel(job: Job, jobBike: JobBike): string {
  const dp = getDisplayPartsForJobBikeRow(job, jobBike);
  return dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ") || "Bike";
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function jobRef(jobId: string | null, currentJobId: string): string {
  if (!jobId) return "an earlier job";
  return jobId === currentJobId ? "this job" : `job #${jobId.slice(-4).toUpperCase()}`;
}

function SpecsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading parts specs">
      <div className="flex gap-3 items-start">
        <div className="h-16 w-16 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <div className="h-4 w-2/3 max-w-xs rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-1/2 max-w-[12rem] rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
      {[0, 1, 2].map((group) => (
        <section
          key={group}
          className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40"
        >
          <div className="mb-3 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="grid grid-cols-1 sm:grid-cols-[minmax(0,9rem)_1fr] gap-2 sm:gap-3"
              >
                <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-full max-w-sm rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SourceBadge({ item }: { item: SpecItemView }) {
  if (item.verified) {
    return (
      <span
        title={`Verified by ${item.verified.by ?? "Bike Ops"} on ${shortDate(item.verified.at)} against ${item.verified.against ?? "a cited source"}`}
        className={`ml-2 ${BADGE} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`}
      >
        Verified
      </span>
    );
  }
  const label = SOURCE_LABELS[item.source ?? "APPROXIMATE"];
  const badgeClass =
    item.source === "APPROXIMATE" || !item.source
      ? "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  return item.sourceUrl ? (
    <a
      href={item.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={item.sourceUrl}
      className={`ml-2 ${BADGE} hover:underline ${badgeClass}`}
    >
      {label}
    </a>
  ) : (
    <span className={`ml-2 ${BADGE} ${badgeClass}`}>{label}</span>
  );
}

type PartActions = {
  busySlot: string | null;
  onSeen: (slot: string, value: string | null) => void;
  onReplacement: (slot: string, state: JobNote["replacementState"], value?: string) => void;
};

function PartRow({
  item,
  currentJobId,
  actions,
}: {
  item: SpecItemView;
  currentJobId: string;
  actions: PartActions;
}) {
  const note = item.job;
  const busy = actions.busySlot === item.slot;
  const linkClass = "text-[11px] font-semibold disabled:opacity-40";

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,9rem)_1fr] gap-0.5 sm:gap-3">
        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {item.label}
          <SourceBadge item={item} />
        </dt>
        <dd className="space-y-1 text-sm text-slate-900 dark:text-slate-100">
          <p>
            <span className="text-xs text-slate-500 dark:text-slate-400">Factory: </span>
            {item.value}
            {item.detail && (
              <span className="block text-xs text-slate-500 dark:text-slate-400">{item.detail}</span>
            )}
          </p>

          {item.installed && (
            <p className="text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">On this bike: </span>
              {item.installed.value}
              <span className="text-slate-500 dark:text-slate-400">
                {" "}— {item.installed.kind === "INSTALLED" ? "fitted" : "noted"} on{" "}
                {jobRef(item.installed.jobId, currentJobId)}, {shortDate(item.installed.recordedAt)}
              </span>
            </p>
          )}

          {note?.confirmation === "MATCHES_CATALOG" && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">This visit: factory part is on the bike</p>
          )}
          {note?.confirmation === "CUSTOMIZED" && note.customValue && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              This visit: on the bike is {note.customValue}
            </p>
          )}
          {note?.replacementState === "PLANNED" && note.replacementValue && (
            <p className="text-xs text-indigo-800 dark:text-indigo-300">
              This visit: planned — {note.replacementValue} (not on the bike yet){" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => actions.onReplacement(item.slot, "INSTALLED")}
                className={`${linkClass} ml-1 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400`}
              >
                Mark installed
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => actions.onReplacement(item.slot, "NONE")}
                className={`${linkClass} ml-2 text-slate-500 hover:text-slate-700`}
              >
                Remove
              </button>
            </p>
          )}
          {note?.replacementState === "INSTALLED" && note.replacementValue && (
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              This visit: installed {note.replacementValue}
              {note.updatedBy ? ` by ${note.updatedBy}` : ""} — saved to the bike when it’s marked done{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => actions.onReplacement(item.slot, "PLANNED")}
                className={`${linkClass} ml-1 text-slate-500 hover:text-slate-700`}
              >
                Not installed
              </button>
            </p>
          )}

          {item.checkBeforeOrdering && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Check on the bike before ordering:</span> {item.fitNote}
            </p>
          )}
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 sm:pl-[9.75rem]">
        {item.visibility !== "INTERNAL" && item.visibility !== "STANDARD" && (
          <>
            <button
              type="button"
              disabled={busy || note?.confirmation === "MATCHES_CATALOG"}
              onClick={() => actions.onSeen(item.slot, null)}
              className={`${linkClass} text-emerald-700 hover:text-emerald-800 dark:text-emerald-400`}
            >
              Factory part is on it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const next = window.prompt(
                  "What part is on the bike now?",
                  note?.customValue ?? item.installed?.value ?? ""
                );
                if (next?.trim()) actions.onSeen(item.slot, next.trim());
              }}
              className={`${linkClass} text-amber-700 hover:text-amber-800 dark:text-amber-400`}
            >
              Different part on it…
            </button>
          </>
        )}
        {(!note || note.replacementState === "NONE") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = window.prompt(
                "What part is going on? (It’s saved to the bike only once you mark it installed and the bike is done.)",
                ""
              );
              if (next?.trim()) actions.onReplacement(item.slot, "PLANNED", next.trim());
            }}
            className={`${linkClass} text-indigo-700 hover:text-indigo-800 dark:text-indigo-400`}
          >
            Replace this part…
          </button>
        )}
      </div>
    </div>
  );
}

function SpecStatusBadge({ status }: { status: MatchedCatalogBike["specStatus"] }) {
  const badge = SPEC_STATUS_BADGES[status] ?? SPEC_STATUS_BADGES.APPROXIMATE;
  return (
    <span title={badge.hint} className={`${BADGE} ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function MatchedBikeHeader({
  matched,
  verifiedParts,
  totalParts,
}: {
  matched: MatchedCatalogBike;
  verifiedParts: number;
  totalParts: number;
}) {
  const title = [matched.yearLabel, matched.maker, matched.model].filter(Boolean).join(" ");
  const subtitle = [matched.family, matched.subcategory, matched.category]
    .filter(Boolean)
    .join(" · ");
  const badge = SPEC_STATUS_BADGES[matched.specStatus] ?? SPEC_STATUS_BADGES.APPROXIMATE;

  return (
    <div className="flex gap-3 items-start">
      {matched.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={matched.thumbnailUrl}
          alt=""
          className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-600 flex-shrink-0"
        />
      ) : null}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <SpecStatusBadge status={matched.specStatus} />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {matched.identityVerified
              ? `Verified by ${matched.identityVerified.by ?? "Bike Ops"} on ${shortDate(matched.identityVerified.at)}. `
              : `${badge.hint} `}
            {verifiedParts} of {totalParts} parts verified.
          </span>
        </div>
        {matched.url && (
          <a
            href={matched.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-2"
          >
            Source
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function LineupNote({
  lineup,
  maker,
}: {
  lineup: NonNullable<BikeSpecsResponse["lineup"]>;
  maker: string;
}) {
  if (lineup.confirmed) {
    return (
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {maker}’s own lineup lists {lineup.builds === 1 ? "only this build" : `${lineup.builds} builds`} under
        this name for this year
        {lineup.sourceUrl && (
          <>
            {" "}(
            <a href={lineup.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
              source
            </a>
            )
          </>
        )}
        .
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-800 dark:text-amber-300">
      {lineup.builds === 1 ? "Only one build was found" : `${lineup.builds} builds were found`}, but {maker}’s full
      lineup for this year wasn’t confirmed — other builds may exist under this name.
    </p>
  );
}

export function BikeSpecsTab({ job }: { job: Job }) {
  const jobBikes = useMemo(
    () => [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [job.jobBikes]
  );
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(jobBikes[0]?.id ?? null);
  const [status, setStatus] = useState<FetchStatus>(() =>
    (job.jobBikes?.length ?? 0) > 0 ? "loading" : "idle"
  );
  const [data, setData] = useState<BikeSpecsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    setSelectedBikeId(jobBikes[0]?.id ?? null);
  }, [job.id, jobBikes]);

  const selectedBike = jobBikes.find((b) => b.id === selectedBikeId) ?? jobBikes[0] ?? null;
  const specs = data?.specs ?? null;
  const candidates = data?.candidates ?? [];
  const lookup = data?.lookup ?? null;

  const loadSpecs = useCallback(
    async (
      jobBikeId: string,
      options: { refresh?: boolean; catalogBikeId?: string; confirm?: boolean; quiet?: boolean } = {}
    ) => {
      if (!options.quiet) {
        setStatus("loading");
        setError(null);
        setPollCount(0);
      }
      try {
        const res = await fetch(`/api/jobs/${job.id}/bike-specs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobBikeId,
            refresh: options.refresh ?? false,
            catalogBikeId: options.catalogBikeId,
            confirm: options.confirm,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as BikeSpecsResponse;
        if (res.status === 409) {
          setError(body.error ?? "That build doesn’t fit this bike");
          setStatus("error");
          return;
        }
        setData(body);

        if (body.status === "catalog_unavailable" || body.status === "unavailable") {
          setStatus("unavailable");
          setError(body.error ?? "Parts couldn’t be loaded right now. Try again in a moment.");
          return;
        }
        if (res.ok && body.specs) {
          setStatus(body.status === "cached" ? "cached" : "fetched");
          return;
        }
        if (body.status === "not_configured") {
          setStatus("not_configured");
          setError(body.error ?? "Bike catalog is not configured");
          return;
        }
        if (body.status === "low_confidence" || body.status === "ambiguous") {
          setStatus(body.status);
          setError(body.error ?? "Could not confidently match this bike");
          return;
        }
        setStatus(res.ok ? "not_fetched" : "no_match");
        setError(body.error ?? "No matching bike found in the catalog");
      } catch {
        if (options.quiet) return;
        setData(null);
        setStatus("error");
        setError("Failed to load bike specs");
      }
    },
    [job.id]
  );

  useEffect(() => {
    if (!selectedBike?.id) return;
    void loadSpecs(selectedBike.id);
  }, [selectedBike?.id, loadSpecs]);

  // The bike is being looked up on the web in the background — check back
  // until it lands in the catalog (or the lookup gives up).
  const searching = lookup === "searching" && !specs && pollCount < LOOKUP_POLL_LIMIT;
  useEffect(() => {
    if (!searching || !selectedBike?.id || status === "loading") return;
    const jobBikeId = selectedBike.id;
    const timer = setTimeout(() => {
      setPollCount((n) => n + 1);
      void loadSpecs(jobBikeId, { quiet: true });
    }, LOOKUP_POLL_MS);
    return () => clearTimeout(timer);
  }, [searching, pollCount, selectedBike?.id, status, loadSpecs]);

  const savePart = useCallback(
    async (slot: string, body: Record<string, unknown>) => {
      if (!selectedBike) return;
      setBusySlot(slot);
      try {
        const res = await fetch(`/api/jobs/${job.id}/bike-specs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobBikeId: selectedBike.id, slot, ...body }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setError(err.error ?? "Failed to save");
          return;
        }
        await loadSpecs(selectedBike.id, { quiet: true });
      } catch {
        setError("Failed to save");
      } finally {
        setBusySlot(null);
      }
    },
    [job.id, loadSpecs, selectedBike]
  );

  const actions: PartActions = {
    busySlot,
    onSeen: (slot, value) =>
      void savePart(
        slot,
        value ? { confirmation: "CUSTOMIZED", customValue: value } : { confirmation: "MATCHES_CATALOG" }
      ),
    onReplacement: (slot, state, value) =>
      void savePart(slot, { replacement: { state, ...(value ? { value } : {}) } }),
  };

  const allItems = specs?.groups.flatMap((g) => g.items) ?? [];
  const verifiedParts = allItems.filter((i) => i.verified).length;
  const factorySlots = new Set(allItems.map((i) => i.slot));
  // Recorded parts the factory sheet doesn't show (or there's no sheet yet).
  const otherInstalled = Object.values(data?.installed ?? {}).filter((p) => !factorySlots.has(p.slot));

  if (jobBikes.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No bikes on this job yet. Add a bike in Details to look up parts specs.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Parts</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
            What this build came with from the factory, what’s been fitted to this customer’s bike since,
            and what you’re doing on this visit. Factory parts show what the bike came with — not what a
            replacement has to fit — so parts marked “check on the bike” need measuring before you order.
          </p>
        </div>
        {selectedBike && (
          <button
            type="button"
            onClick={() => void loadSpecs(selectedBike.id, { refresh: true })}
            disabled={status === "loading"}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {jobBikes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {jobBikes.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBikeId(b.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                selectedBike?.id === b.id
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
              }`}
            >
              {bikeRowLabel(job, b)}
            </button>
          ))}
        </div>
      )}

      {selectedBike && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Searching as:{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {[selectedBike.year, selectedBike.make, selectedBike.model].filter(Boolean).join(" ")}
          </span>
        </p>
      )}

      {status === "loading" && <SpecsSkeleton />}

      {status === "not_configured" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">Bike catalog not configured</p>
          <p className="mt-1 text-xs leading-relaxed">
            Set <code className="font-mono">CATALOG_DATABASE_URL</code> (or reuse{" "}
            <code className="font-mono">DATABASE_URL</code>), then run{" "}
            <code className="font-mono">npm run catalog:push</code> and{" "}
            <code className="font-mono">npm run catalog:seed</code>.
          </p>
        </div>
      )}

      {searching && status !== "loading" && (
        <div
          className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/40"
          role="status"
        >
          <span className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Looking this bike up on the web…
            </p>
            <p className="mt-1 text-xs text-indigo-800/80 dark:text-indigo-300/80">
              It’s not in the catalog yet. We’re finding its factory parts list, which usually takes a
              minute or two. It’ll be saved so the next one is instant.
            </p>
          </div>
        </div>
      )}

      {!["loading", "not_configured"].includes(status) && error && !specs && !searching && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>
          {lookup && lookup !== "searching" && !(lookup === "needs_choice" && status === "ambiguous") && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{LOOKUP_MESSAGES[lookup]}</p>
          )}
          {data?.lineup && selectedBike && (
            <div className="mt-2">
              <LineupNote lineup={data.lineup} maker={selectedBike.make} />
            </div>
          )}
          {(status === "low_confidence" || status === "ambiguous") && candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {status === "ambiguous"
                  ? "Which build is this bike? Check the parts on the bike, then select one."
                  : "Possible matches — select one only if it’s this exact bike."}
                {data?.build?.canRemember && " It’s remembered for this customer’s next visit."}
              </p>
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void loadSpecs(selectedBike!.id, { catalogBikeId: c.id })}
                      className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-600 dark:hover:border-indigo-500"
                    >
                      <span className="font-medium text-slate-900 dark:text-white">
                        {[c.yearLabel, c.maker, c.model].filter(Boolean).join(" ")}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <SpecStatusBadge status={c.specStatus} />
                        {c.family && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">{c.family}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {status === "unavailable" ? (
            <button
              type="button"
              onClick={() => selectedBike && void loadSpecs(selectedBike.id)}
              className="mt-3 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
            >
              Try again
            </button>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Tip: refine the bike make, model, and year in Details, then refresh.
            </p>
          )}
        </div>
      )}

      {specs && status !== "loading" && (
        <div className="space-y-4">
          <MatchedBikeHeader matched={specs.matched} verifiedParts={verifiedParts} totalParts={allItems.length} />

          {data?.build?.confirmed ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Confirmed as this customer’s bike
              {data.build.confirmedBy ? ` by ${data.build.confirmedBy}` : ""}
              {data.build.confirmedAt ? ` on ${shortDate(data.build.confirmedAt)}` : ""}.
            </p>
          ) : data?.build?.canRemember ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
              <span className="text-slate-600 dark:text-slate-300">
                Matched automatically. Is this the customer’s exact build?
              </span>
              <button
                type="button"
                disabled={confirming}
                onClick={async () => {
                  if (!selectedBike) return;
                  setConfirming(true);
                  await loadSpecs(selectedBike.id, { confirm: true, quiet: true });
                  setConfirming(false);
                }}
                className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Yes, remember it
              </button>
            </div>
          ) : null}

          {data?.lineup && <LineupNote lineup={data.lineup} maker={specs.matched.maker} />}

          {specs.groups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No component specs available for this bike.</p>
          ) : (
            specs.groups.map((group) => (
              <section
                key={group.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40"
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                  {group.title}
                </h4>
                <dl className="space-y-4">
                  {group.items.map((item) => (
                    <PartRow key={item.slot || item.label} item={item} currentJobId={job.id} actions={actions} />
                  ))}
                </dl>
              </section>
            ))
          )}
        </div>
      )}

      {otherInstalled.length > 0 && status !== "loading" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Recorded on this bike
          </h4>
          <ul className="space-y-1 text-sm text-slate-800 dark:text-slate-200">
            {otherInstalled.map((p) => (
              <li key={p.slot}>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {SLOT_META[p.slot as keyof typeof SLOT_META]?.label ?? p.slot}:{" "}
                </span>
                {p.value}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {" "}— {p.kind === "INSTALLED" ? "fitted" : "noted"} on {jobRef(p.jobId, job.id)},{" "}
                  {shortDate(p.recordedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && specs && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
