"use client";

import { useState, useEffect, useCallback } from "react";
import { Price } from "@/components/ui/Price";

interface Stats {
  bikes: { day: number; week: number; month: number; year: number };
  revenue: { day: number; week: number; month: number; year: number };
  shopRevenue: { day: number; week: number; month: number; year: number };
  stripeRevenue?: { day: number; week: number; month: number; year: number };
  cashRevenue?: { day: number; week: number; month: number; year: number };
  importedRevenue: { day: number; week: number; month: number; year: number };
  lastYear?: {
    calendarYear: number;
    revenue: number;
    shopRevenue: number;
    stripeRevenue: number;
    cashRevenue: number;
    importedRevenue: number;
  };
  topServices: { name: string; count: number; revenue: number }[];
}

const PERIODS = [
  { key: "day" as const, label: "Today" },
  { key: "week" as const, label: "This Week" },
  { key: "month" as const, label: "This Month" },
  { key: "year" as const, label: "This Year" },
] as const;

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const reloadStats = useCallback(
    () => fetch("/api/stats").then((res) => res.json()).then(setStats),
    []
  );

  useEffect(() => {
    reloadStats().finally(() => setLoading(false));
  }, [reloadStats]);

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading stats...</div>
    );
  }

  if (!stats) {
    return (
      <div className="py-12 text-center text-red-600">Failed to load stats.</div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Stats</h1>
      <p className="text-slate-600 mb-8">
        Completed bikes by when the job finished. Revenue uses recorded payments when available
        (Stripe card charges and cash), so card totals match what hit Stripe; imported history
        (e.g. Square) is separate.
      </p>

	      {stats.lastYear && (
	        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm mb-6 max-w-md">
	          <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
	            Last Year ({stats.lastYear.calendarYear})
	          </p>
	          <div>
	            <Price amount={stats.lastYear.revenue} variant="total" className="text-2xl" />
	            <p className="text-sm text-slate-600">revenue</p>
	            {(() => {
              const stripe = stats.lastYear.stripeRevenue;
              const cash = stats.lastYear.cashRevenue;
              const imp = stats.lastYear.importedRevenue;
              const parts: { label: string; amount: number }[] = [];
              if (stripe > 0) parts.push({ label: "Stripe", amount: stripe });
              if (cash > 0) parts.push({ label: "Cash", amount: cash });
              if (imp > 0) parts.push({ label: "imported", amount: imp });
              if (parts.length === 0) return null;
              return (
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {parts.map((p, i) => (
                    <span key={p.label}>
                      {i > 0 ? " · " : null}
                      {p.label}{" "}
                      <Price amount={p.amount} variant="inline" className="text-xs" />
                    </span>
                  ))}
                </p>
              );
            })()}
          </div>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-10">
        {PERIODS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
              {label}
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.bikes[key]}
                </p>
                <p className="text-sm text-slate-600">bikes completed</p>
              </div>
              <div>
                <Price amount={stats.revenue[key]} variant="total" className="text-xl" />
                <p className="text-sm text-slate-600">revenue</p>
                {(() => {
                  const stripe = stats.stripeRevenue?.[key] ?? 0;
                  const cash = stats.cashRevenue?.[key] ?? 0;
                  const imp = stats.importedRevenue[key];
                  const parts: { label: string; amount: number }[] = [];
                  if (stripe > 0) parts.push({ label: "Stripe", amount: stripe });
                  if (cash > 0) parts.push({ label: "Cash", amount: cash });
                  if (imp > 0) parts.push({ label: "imported", amount: imp });
                  if (parts.length === 0) return null;
                  return (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      {parts.map((p, i) => (
                        <span key={p.label}>
                          {i > 0 ? " · " : null}
                          {p.label}{" "}
                          <Price amount={p.amount} variant="inline" className="text-xs" />
                        </span>
                      ))}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Top 5 Services
        </h2>
        {stats.topServices.length === 0 ? (
          <p className="text-slate-500 py-6">No completed services yet.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-sm font-semibold text-slate-700">
                    #
                  </th>
                  <th className="px-5 py-3 text-left text-sm font-semibold text-slate-700">
                    Service
                  </th>
                  <th className="px-5 py-3 text-right text-sm font-semibold text-slate-700">
                    Count
                  </th>
                  <th className="px-5 py-3 text-right text-sm font-semibold text-slate-700">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.topServices.map((svc, i) => (
                  <tr
                    key={svc.name}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="px-5 py-3 text-sm text-slate-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {svc.name}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {svc.count}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Price amount={svc.revenue} variant="inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-12 pt-8 border-t border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Historical Square (or other) revenue
        </h2>
        <p className="text-slate-600 text-sm mb-4 max-w-2xl">
          If you processed payments in Square before this app, export your transactions from the
          Square Dashboard (Reports → Sales, or Transactions) as CSV, then upload it here. Amounts
          are added to the revenue totals above. Rows with a Payment ID column are de-duplicated if
          you re-import.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!importFile) {
              setImportStatus("Choose a CSV file first.");
              return;
            }
            setImportBusy(true);
            setImportStatus(null);
            const fd = new FormData();
            fd.append("file", importFile);
            fd.append("source", "SQUARE");
            try {
              const res = await fetch("/api/imported-revenue", {
                method: "POST",
                body: fd,
              });
              const raw = await res.text();
              let data: {
                error?: string;
                ok?: boolean;
                processed?: number;
                created?: number;
                updated?: number;
                warnings?: string[];
              } = {};
              try {
                data = raw ? (JSON.parse(raw) as typeof data) : {};
              } catch {
                setImportStatus(
                  `Import failed (HTTP ${res.status}). The server did not return JSON — often a timeout or gateway error with large files. ${raw.slice(0, 280)}`
                );
                return;
              }
              if (!res.ok) {
                setImportStatus(data.error ?? `Import failed (HTTP ${res.status}).`);
                return;
              }
              const w = data.warnings?.length
                ? ` Warnings: ${data.warnings.slice(0, 3).join(" ")}`
                : "";
              setImportStatus(
                `Imported ${data.processed} row(s) (${data.created} new, ${data.updated} updated).${w}`
              );
              setImportFile(null);
              try {
                await reloadStats();
              } catch (reloadErr) {
                console.error("reloadStats after import:", reloadErr);
                setImportStatus((prev) =>
                  prev
                    ? `${prev} Stats could not refresh automatically — reload the page.`
                    : "Stats could not refresh — reload the page."
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setImportStatus(
                `Request failed: ${msg}. If the file is very large, try splitting the CSV or importing again (rows with Payment IDs update in place).`
              );
            } finally {
              setImportBusy(false);
            }
          }}
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button
            type="submit"
            disabled={importBusy}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {importBusy ? "Importing…" : "Import CSV"}
          </button>
        </form>
        {importStatus && (
          <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{importStatus}</p>
        )}
      </section>
    </div>
  );
}
