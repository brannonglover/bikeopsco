"use client";

import { useState } from "react";
import Link from "next/link";
import {
  broadcastAppFeaturesUpdated,
  useAppFeatures,
} from "@/contexts/AppFeaturesContext";

export function SettingsTab() {
  const features = useAppFeatures();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setRentalsEnabled = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/app-features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rentalsEnabled: enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to update");
        return;
      }
      const data = await res.json();
      broadcastAppFeaturesUpdated(data);
      setSaved(true);
    } catch {
      setError("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full min-w-0 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Rental Settings
        </h2>
        <p className="text-sm text-slate-500">
          Configure how rentals work at your shop.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Enable rentals
            </p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              When disabled, the Rentals page is hidden from the sidebar. Turn this
              off if your shop does not rent bikes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={features.rentalsEnabled}
            aria-label={`Rentals: ${features.rentalsEnabled ? "enabled" : "disabled"}`}
            disabled={saving}
            onClick={() => setRentalsEnabled(!features.rentalsEnabled)}
            className="group flex flex-shrink-0 cursor-pointer items-center gap-2.5 rounded-lg py-0.5 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={`min-w-[4.25rem] text-right text-xs font-semibold tabular-nums ${
                features.rentalsEnabled
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-slate-400"
              }`}
            >
              {features.rentalsEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              aria-hidden
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                features.rentalsEnabled ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                  features.rentalsEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {saved && !error && (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          You can also manage this under{" "}
          <Link
            href="/settings/features"
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            Settings → Features
          </Link>
          .
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        <p className="font-medium text-slate-800 dark:text-slate-100">Getting started</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Add bikes to your fleet under the Fleet tab.</li>
          <li>Set duration pricing under Rates (e.g. 1 day, 3 days, weekly).</li>
          <li>Optionally add helmets and locks under Add-ons.</li>
          <li>Create reservations from Overview or the Reservations tab.</li>
        </ol>
      </div>
    </div>
  );
}
