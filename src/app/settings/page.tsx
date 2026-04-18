"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";

type AppFeatures = {
  collectionServiceEnabled: boolean;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

const DEFAULT_FEATURES: AppFeatures = {
  collectionServiceEnabled: true,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use the light colour scheme" },
  { value: "dark", label: "Dark", description: "Always use the dark colour scheme" },
  { value: "system", label: "System", description: "Follow your device settings" },
];

function ThemeIcon({ mode, active }: { mode: ThemeMode; active: boolean }) {
  const base = active ? "text-primary-500" : "text-text-secondary dark:text-text-secondary";

  if (mode === "light") {
    return (
      <svg className={`w-6 h-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg className={`w-6 h-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    );
  }
  return (
    <svg className={`w-6 h-6 ${base}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
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

export default function SettingsPage() {
  const { themeMode, setThemeMode } = useTheme();

  const [features, setFeatures] = useState<AppFeatures>(DEFAULT_FEATURES);
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [featuresError, setFeaturesError] = useState<string | null>(null);
  const [featuresSaved, setFeaturesSaved] = useState(false);

  const fetchFeatures = useCallback(async () => {
    setFeaturesError(null);
    setFeaturesLoading(true);
    try {
      const res = await fetch("/api/settings/app-features", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as Partial<AppFeatures>;
      setFeatures({ ...DEFAULT_FEATURES, ...data });
    } catch {
      setFeaturesError("Failed to load settings.");
    } finally {
      setFeaturesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const saveFeatures = async (next: AppFeatures) => {
    setFeaturesSaving(true);
    setFeaturesSaved(false);
    setFeaturesError(null);
    try {
      const res = await fetch("/api/settings/app-features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeaturesError(typeof data?.error === "string" ? data.error : "Failed to save.");
        return;
      }
      setFeatures({ ...DEFAULT_FEATURES, ...(data as AppFeatures) });
      setFeaturesSaved(true);
      window.setTimeout(() => setFeaturesSaved(false), 1500);
    } catch {
      setFeaturesError("Failed to save.");
    } finally {
      setFeaturesSaving(false);
    }
  };

  const setFeatureFlag = (key: keyof AppFeatures, value: boolean) => {
    const next = { ...features, [key]: value };
    setFeatures(next);
    void saveFeatures(next);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
        <p className="text-text-secondary">Manage your Bike Ops settings.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground mb-1">Appearance</h2>
          <p className="text-text-secondary">Customise how Bike Ops looks on your device.</p>
        </div>

        <div className="space-y-3">
          {THEME_OPTIONS.map((opt) => {
            const selected = themeMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setThemeMode(opt.value)}
                className={`w-full flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition-all ${
                  selected
                    ? "border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/20"
                    : "border-surface-border bg-surface hover:border-text-muted"
                }`}
              >
                <div
                  className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg ${
                    selected ? "bg-primary-500/15" : "bg-subtle-bg"
                  }`}
                >
                  <ThemeIcon mode={opt.value} active={selected} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{opt.label}</div>
                  <div className="text-sm text-text-secondary">{opt.description}</div>
                </div>
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selected ? "border-primary-500 bg-primary-500" : "border-text-muted bg-transparent"
                  }`}
                >
                  {selected && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Features</h2>
          <p className="text-sm text-slate-600">
            Enable or disable optional features. Changes apply immediately.
          </p>
        </div>

        {featuresLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading…</div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <ToggleRow
              title="Collection service"
              description="Allow collection/pickup bookings and collection delivery type."
              checked={features.collectionServiceEnabled}
              disabled={featuresSaving}
              onChange={(v) => setFeatureFlag("collectionServiceEnabled", v)}
            />
            <ToggleRow
              title="Notify customer toggle"
              description="Show the 'Notify customer' checkbox on the job board and allow email/SMS sends."
              checked={features.notifyCustomerEnabled}
              disabled={featuresSaving}
              onChange={(v) => setFeatureFlag("notifyCustomerEnabled", v)}
            />
            <ToggleRow
              title="Chat"
              description="Enable staff/customer chat pages."
              checked={features.chatEnabled}
              disabled={featuresSaving}
              onChange={(v) => setFeatureFlag("chatEnabled", v)}
            />
            <ToggleRow
              title="Reviews"
              description="Enable reviews settings and the reviews widget."
              checked={features.reviewsEnabled}
              disabled={featuresSaving}
              onChange={(v) => setFeatureFlag("reviewsEnabled", v)}
            />

            {(featuresError || featuresSaved) && (
              <div className="pt-2">
                {featuresError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {featuresError}
                  </div>
                )}
                {featuresSaved && !featuresError && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Saved.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

