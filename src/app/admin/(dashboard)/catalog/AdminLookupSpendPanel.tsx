"use client";

import { useEffect, useState } from "react";

type DailySpend = {
  day: string;
  spentUsd: number;
  estimatedUsd: number;
  calls: number;
  overBudgetUsd: number;
};

type LookupRow = {
  key: string;
  make: string;
  model: string;
  year: number;
  status: "SEARCHING" | "FOUND" | "NOT_FOUND" | "FAILED";
  attempts: number;
  builds: number;
  lineupConfirmed: boolean;
  message: string | null;
  updatedAt: string;
  costUsd: number;
};

type Payload = {
  spend: { budgetUsd: number; softCap: true; days: DailySpend[] };
  lookups: LookupRow[];
};

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function lookupOutcome(row: LookupRow): string {
  if (row.status === "FOUND") {
    if (row.builds === 1 && row.lineupConfirmed) return "1 build (lineup confirmed)";
    return `${row.builds} build${row.builds === 1 ? "" : "s"}${row.lineupConfirmed ? " (lineup confirmed)" : " — lineup not confirmed"}`;
  }
  if (row.status === "NOT_FOUND") return "Not found";
  if (row.status === "SEARCHING") return "Searching";
  return row.message ? `Failed: ${row.message}` : "Failed";
}

/** Web lookup spend against the soft daily cap, and what recent lookups found. */
export function AdminLookupSpendPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/platform/catalog/lookups", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as (Payload & { error?: string }) | null;
        if (!res.ok || !body) {
          setError(body?.error ?? "Failed to load lookup spend");
          return;
        }
        setData(body);
      } catch {
        setError("Failed to load lookup spend");
      }
    })();
  }, []);

  if (error) {
    return <p className="mb-6 text-sm text-red-600">{error}</p>;
  }
  if (!data) return null;

  const today = data.spend.days[0];
  const overDays = data.spend.days.filter((d) => d.overBudgetUsd > 0);

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Web lookup spend</h3>
        <p className="text-xs text-slate-500">
          Soft daily cap {usd(data.spend.budgetUsd)} (UTC day) — stops new lookups, but a lookup
          already running can finish over it.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-slate-500">Today</p>
          <p className="font-semibold text-slate-900">
            {usd(today.spentUsd)} <span className="font-normal text-slate-500">of {usd(data.spend.budgetUsd)}</span>
          </p>
          {today.overBudgetUsd > 0 && (
            <p className="text-xs font-semibold text-red-700">Over the cap by {usd(today.overBudgetUsd)}</p>
          )}
          {today.estimatedUsd > 0 && (
            <p className="text-xs text-slate-500">
              Includes {usd(today.estimatedUsd)} estimated for calls that never reported usage
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-500">Last 7 days</p>
          <p className="font-semibold text-slate-900">
            {usd(data.spend.days.reduce((sum, d) => sum + d.spentUsd, 0))}
            <span className="font-normal text-slate-500">
              {" "}· {data.spend.days.reduce((sum, d) => sum + d.calls, 0)} calls
            </span>
          </p>
          {overDays.length > 0 && (
            <p className="text-xs font-semibold text-red-700">
              Over the cap on {overDays.map((d) => `${d.day} (+${usd(d.overBudgetUsd)})`).join(", ")}
            </p>
          )}
        </div>
      </div>

      {data.lookups.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Bike searched</th>
                <th className="py-1.5 pr-4 font-medium">Outcome</th>
                <th className="py-1.5 pr-4 font-medium">Attempts</th>
                <th className="py-1.5 pr-4 font-medium">Cost</th>
                <th className="py-1.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {data.lookups.map((row) => (
                <tr key={row.key}>
                  <td className="py-1.5 pr-4">{`${row.year} ${row.make} ${row.model}`}</td>
                  <td className="py-1.5 pr-4">{lookupOutcome(row)}</td>
                  <td className="py-1.5 pr-4">{row.attempts}</td>
                  <td className="py-1.5 pr-4">{usd(row.costUsd)}</td>
                  <td className="py-1.5">{new Date(row.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
