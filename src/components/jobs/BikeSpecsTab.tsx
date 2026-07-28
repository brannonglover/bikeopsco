"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, JobBike } from "@/lib/types";
import type { BikeSpecsPayload, MatchedCatalogBike } from "@/lib/bike-specs";
import { getDisplayPartsForJobBikeRow } from "@/lib/job-display";

type FetchStatus =
  | "idle"
  | "loading"
  | "cached"
  | "fetched"
  | "not_fetched"
  | "not_configured"
  | "no_match"
  | "low_confidence"
  | "error";

type SpecItemView = {
  slot: string;
  label: string;
  value: string;
  detail?: string;
  visibility?: string;
  confirmation?: "UNREVIEWED" | "MATCHES_CATALOG" | "CUSTOMIZED";
  catalogValue?: string;
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
};

function bikeRowLabel(job: Job, jobBike: JobBike): string {
  const dp = getDisplayPartsForJobBikeRow(job, jobBike);
  return dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ") || "Bike";
}

function confirmationBadge(confirmation?: SpecItemView["confirmation"]) {
  if (confirmation === "MATCHES_CATALOG") {
    return (
      <span className="ml-2 inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
        Confirmed
      </span>
    );
  }
  if (confirmation === "CUSTOMIZED") {
    return (
      <span className="ml-2 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
        Customized
      </span>
    );
  }
  return (
    <span className="ml-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      From catalog
    </span>
  );
}

function SpecGroup({
  title,
  items,
  onConfirm,
  onCustomize,
  busySlot,
}: {
  title: string;
  items: SpecItemView[];
  onConfirm: (slot: string) => void;
  onCustomize: (slot: string, currentValue: string) => void;
  busySlot: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        {title}
      </h4>
      <dl className="space-y-3">
        {items.map((item) => (
          <div key={item.slot || item.label} className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,9rem)_1fr] gap-0.5 sm:gap-3">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {item.label}
                {confirmationBadge(item.confirmation)}
              </dt>
              <dd className="text-sm text-slate-900 dark:text-slate-100">
                {item.value}
                {item.detail && (
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.detail}</span>
                )}
                {item.confirmation === "CUSTOMIZED" && item.catalogValue && (
                  <span className="block text-xs text-slate-400 mt-0.5">
                    Catalog: {item.catalogValue}
                  </span>
                )}
              </dd>
            </div>
            {item.visibility !== "INTERNAL" && item.visibility !== "STANDARD" && (
              <div className="flex flex-wrap gap-2 sm:pl-[9.75rem]">
                <button
                  type="button"
                  disabled={busySlot === item.slot || item.confirmation === "MATCHES_CATALOG"}
                  onClick={() => onConfirm(item.slot)}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-40 dark:text-emerald-400"
                >
                  Looks right
                </button>
                <button
                  type="button"
                  disabled={busySlot === item.slot}
                  onClick={() => onCustomize(item.slot, item.value)}
                  className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-40 dark:text-amber-400"
                >
                  Replaced with…
                </button>
              </div>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

function MatchedBikeHeader({ matched }: { matched: MatchedCatalogBike }) {
  const title = [matched.year, matched.maker, matched.model].filter(Boolean).join(" ");
  const subtitle = [matched.family, matched.subcategory, matched.category]
    .filter(Boolean)
    .join(" · ");

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

export function BikeSpecsTab({ job }: { job: Job }) {
  const jobBikes = useMemo(
    () => [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [job.jobBikes]
  );
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(jobBikes[0]?.id ?? null);
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [specs, setSpecs] = useState<BikeSpecsResponse["specs"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchedCatalogBike[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBikeId(jobBikes[0]?.id ?? null);
  }, [job.id, jobBikes]);

  const selectedBike = jobBikes.find((b) => b.id === selectedBikeId) ?? jobBikes[0] ?? null;

  const loadSpecs = useCallback(
    async (jobBikeId: string, refresh = false, catalogBikeId?: string) => {
      setStatus("loading");
      setError(null);
      setCandidates([]);
      try {
        const res = await fetch(`/api/jobs/${job.id}/bike-specs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobBikeId, refresh, catalogBikeId }),
        });
        const data = (await res.json().catch(() => ({}))) as BikeSpecsResponse;

        if (res.ok && data.specs) {
          setSpecs(data.specs);
          setFetchedAt(data.fetchedAt ?? null);
          setStatus(data.status === "cached" ? "cached" : "fetched");
          return;
        }

        if (data.status === "not_configured") {
          setSpecs(null);
          setStatus("not_configured");
          setError(data.error ?? "Bike catalog is not configured");
          return;
        }

        if (data.status === "low_confidence") {
          setSpecs(null);
          setStatus("low_confidence");
          setCandidates(data.candidates ?? []);
          setError(data.error ?? "Could not confidently match this bike");
          return;
        }

        setSpecs(null);
        setStatus(res.ok ? "not_fetched" : "no_match");
        setError(data.error ?? "No matching bike found in the catalog");
        if (data.candidates?.length) setCandidates(data.candidates);
      } catch {
        setSpecs(null);
        setStatus("error");
        setError("Failed to load bike specs");
      }
    },
    [job.id]
  );

  useEffect(() => {
    if (!selectedBike?.id) return;
    void loadSpecs(selectedBike.id, false);
  }, [selectedBike?.id, loadSpecs]);

  const saveOverride = useCallback(
    async (
      slot: string,
      confirmation: "MATCHES_CATALOG" | "CUSTOMIZED" | "UNREVIEWED",
      customValue?: string | null
    ) => {
      if (!selectedBike) return;
      setBusySlot(slot);
      try {
        const res = await fetch(`/api/jobs/${job.id}/bike-specs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobBikeId: selectedBike.id,
            slot,
            confirmation,
            customValue: customValue ?? null,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Failed to save confirmation");
          return;
        }
        await loadSpecs(selectedBike.id, false);
      } catch {
        setError("Failed to save confirmation");
      } finally {
        setBusySlot(null);
      }
    },
    [job.id, loadSpecs, selectedBike]
  );

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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Parts lookup specs</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
            Component details from the Bike Ops catalog — bottom bracket, wheels, drivetrain, and more —
            to help find replacement parts. Confirm visual parts or note customizations without tearing
            the bike down.
          </p>
        </div>
        {selectedBike && (
          <button
            type="button"
            onClick={() => void loadSpecs(selectedBike.id, true)}
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

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-8 justify-center">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading specs from catalog…
        </div>
      )}

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

      {!["loading", "not_configured"].includes(status) && error && !specs && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>
          {status === "low_confidence" && candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">Possible matches — select one:</p>
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void loadSpecs(selectedBike!.id, true, c.id)}
                      className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-600 dark:hover:border-indigo-500"
                    >
                      <span className="font-medium text-slate-900 dark:text-white">
                        {[c.year, c.maker, c.model].filter(Boolean).join(" ")}
                      </span>
                      {c.family && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{c.family}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Tip: refine the bike make, model, and year in Details, then refresh.
          </p>
        </div>
      )}

      {specs && status !== "loading" && (
        <div className="space-y-4">
          <MatchedBikeHeader matched={specs.matched} />
          {fetchedAt && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Last matched {new Date(fetchedAt).toLocaleString()}
            </p>
          )}
          {specs.groups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No component specs available for this bike.</p>
          ) : (
            specs.groups.map((group) => (
              <SpecGroup
                key={group.id}
                title={group.title}
                items={group.items}
                busySlot={busySlot}
                onConfirm={(slot) => void saveOverride(slot, "MATCHES_CATALOG")}
                onCustomize={(slot, currentValue) => {
                  const next = window.prompt("What part is actually on this bike?", currentValue);
                  if (next == null) return;
                  const trimmed = next.trim();
                  if (!trimmed) return;
                  void saveOverride(slot, "CUSTOMIZED", trimmed);
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
