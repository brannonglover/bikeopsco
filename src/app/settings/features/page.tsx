"use client";

import { useCallback, useEffect, useState } from "react";

type AppFeatures = {
  collectionServiceEnabled: boolean;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

const DEFAULTS: AppFeatures = {
  collectionServiceEnabled: true,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

export default function FeaturesSettingsPage() {
  const [features, setFeatures] = useState<AppFeatures>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchFeatures = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/settings/app-features", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as Partial<AppFeatures>;
      setFeatures({ ...DEFAULTS, ...data });
    } catch {
      setError("Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const save = async (next: AppFeatures) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings/app-features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to save.");
        return;
      }
      setFeatures({ ...DEFAULTS, ...(data as AppFeatures) });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const setFlag = (key: keyof AppFeatures, value: boolean) => {
    const next = { ...features, [key]: value };
    setFeatures(next);
    void save(next);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Features</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enable or disable optional features. Changes apply immediately.
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading…
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <ToggleRow
            title="Collection service"
            description="Allow collection/pickup bookings and collection delivery type."
            checked={features.collectionServiceEnabled}
            disabled={saving}
            onChange={(v) => setFlag("collectionServiceEnabled", v)}
          />
          <ToggleRow
            title="Notify customer toggle"
            description="Show the 'Notify customer' checkbox on the job board and allow email/SMS sends."
            checked={features.notifyCustomerEnabled}
            disabled={saving}
            onChange={(v) => setFlag("notifyCustomerEnabled", v)}
          />
          <ToggleRow
            title="Chat"
            description="Enable staff/customer chat pages."
            checked={features.chatEnabled}
            disabled={saving}
            onChange={(v) => setFlag("chatEnabled", v)}
          />
          <ToggleRow
            title="Reviews"
            description="Enable reviews settings and the reviews widget."
            checked={features.reviewsEnabled}
            disabled={saving}
            onChange={(v) => setFlag("reviewsEnabled", v)}
          />
          {(error || saved) && (
            <div className="pt-2">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {saved && !error && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Saved.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer select-none">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block mt-0.5 text-sm text-slate-600">{description}</span>
      </span>
      <span className="flex items-center gap-2 flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
        />
      </span>
    </label>
  );
}

