"use client";

import { useCallback, useEffect, useState } from "react";
import { broadcastAppFeaturesUpdated } from "@/contexts/AppFeaturesContext";

type AppFeatures = {
  bookingsEnabled: boolean;
  maxActiveBikes: number;
  closedDates: ClosedDate[];
  collectionServiceEnabled: boolean;
  collectionRadiusMiles: number;
  collectionFeeRegular: number;
  collectionFeeEbike: number;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

type ClosedDate = {
  date: string;
  reason?: string;
};

type FeatureFlagKey =
  | "bookingsEnabled"
  | "collectionServiceEnabled"
  | "notifyCustomerEnabled"
  | "chatEnabled"
  | "reviewsEnabled";

const DEFAULT_FEATURES: AppFeatures = {
  bookingsEnabled: true,
  maxActiveBikes: 5,
  closedDates: [],
  collectionServiceEnabled: true,
  collectionRadiusMiles: 5,
  collectionFeeRegular: 20,
  collectionFeeEbike: 30,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

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
    <label className="flex cursor-pointer select-none items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-text-secondary">{description}</span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 rounded border-surface-border text-amber-600 focus:ring-amber-500"
        />
      </span>
    </label>
  );
}

export default function FeatureSettingsPage() {
  const [features, setFeatures] = useState<AppFeatures>(DEFAULT_FEATURES);
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [featuresError, setFeaturesError] = useState<string | null>(null);
  const [featuresSaved, setFeaturesSaved] = useState(false);
  const [maxActiveBikesInput, setMaxActiveBikesInput] = useState(String(DEFAULT_FEATURES.maxActiveBikes));
  const [bookingDirty, setBookingDirty] = useState(false);
  const [collectionRadiusInput, setCollectionRadiusInput] = useState(String(DEFAULT_FEATURES.collectionRadiusMiles));
  const [collectionFeeRegularInput, setCollectionFeeRegularInput] = useState(String(DEFAULT_FEATURES.collectionFeeRegular));
  const [collectionFeeEbikeInput, setCollectionFeeEbikeInput] = useState(String(DEFAULT_FEATURES.collectionFeeEbike));
  const [collectionDirty, setCollectionDirty] = useState(false);
  const [closedDateInput, setClosedDateInput] = useState("");
  const [closedDateReasonInput, setClosedDateReasonInput] = useState("");
  const [bookingSettingsSaving, setBookingSettingsSaving] = useState(false);

  const fetchFeatures = useCallback(async () => {
    setFeaturesError(null);
    setFeaturesLoading(true);
    try {
      const res = await fetch("/api/settings/app-features", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as Partial<AppFeatures>;
      const next = { ...DEFAULT_FEATURES, ...data };
      setFeatures(next);
      setMaxActiveBikesInput(String(next.maxActiveBikes));
      setBookingDirty(false);
      setCollectionRadiusInput(String(next.collectionRadiusMiles));
      setCollectionFeeRegularInput(String(next.collectionFeeRegular));
      setCollectionFeeEbikeInput(String(next.collectionFeeEbike));
      setCollectionDirty(false);
      setClosedDateInput("");
      setClosedDateReasonInput("");
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
      const updated = { ...DEFAULT_FEATURES, ...(data as AppFeatures) };
      setFeatures(updated);
      broadcastAppFeaturesUpdated(updated);
      setMaxActiveBikesInput(String(updated.maxActiveBikes));
      setBookingDirty(false);
      setCollectionRadiusInput(String(updated.collectionRadiusMiles));
      setCollectionFeeRegularInput(String(updated.collectionFeeRegular));
      setCollectionFeeEbikeInput(String(updated.collectionFeeEbike));
      setCollectionDirty(false);
      setBookingSettingsSaving(false);
      setFeaturesSaved(true);
      window.setTimeout(() => setFeaturesSaved(false), 1500);
    } catch {
      setFeaturesError("Failed to save.");
    } finally {
      setBookingSettingsSaving(false);
      setFeaturesSaving(false);
    }
  };

  const setFeatureFlag = (key: FeatureFlagKey, value: boolean) => {
    const next = { ...features, [key]: value };
    setFeatures(next);
    void saveFeatures(next);
  };

  const saveCollectionSettings = () => {
    const radius = Number(collectionRadiusInput);
    const feeRegular = Number(collectionFeeRegularInput);
    const feeEbike = Number(collectionFeeEbikeInput);
    if (!Number.isFinite(radius) || radius < 0.1 || radius > 100) {
      setFeaturesError("Collection radius must be between 0.1 and 100 miles.");
      return;
    }
    if (!Number.isFinite(feeRegular) || feeRegular < 0 || feeRegular > 10000) {
      setFeaturesError("Collection fee (standard) must be between $0 and $10,000.");
      return;
    }
    if (!Number.isFinite(feeEbike) || feeEbike < 0 || feeEbike > 10000) {
      setFeaturesError("Collection fee (e-bike) must be between $0 and $10,000.");
      return;
    }

    const next: AppFeatures = {
      ...features,
      collectionRadiusMiles: radius,
      collectionFeeRegular: feeRegular,
      collectionFeeEbike: feeEbike,
    };
    setFeatures(next);
    setCollectionDirty(false);
    void saveFeatures(next);
  };

  const saveBookingSettings = () => {
    const n = Number(maxActiveBikesInput);
    if (!Number.isFinite(n) || n < 0 || n > 200 || !Number.isInteger(n)) {
      setFeaturesError("Max active bikes must be a whole number between 0 and 200.");
      return;
    }

    const next: AppFeatures = {
      ...features,
      maxActiveBikes: n,
    };
    setFeatures(next);
    setBookingDirty(false);
    setBookingSettingsSaving(true);
    void saveFeatures(next);
  };

  const addClosedDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closedDateInput)) {
      setFeaturesError("Choose a valid closed date.");
      return;
    }

    const reason = closedDateReasonInput.trim();
    const nextClosedDates = [
      ...features.closedDates.filter((d) => d.date !== closedDateInput),
      {
        date: closedDateInput,
        ...(reason ? { reason: reason.slice(0, 80) } : {}),
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    const next: AppFeatures = { ...features, closedDates: nextClosedDates };
    setFeatures(next);
    setClosedDateInput("");
    setClosedDateReasonInput("");
    setBookingSettingsSaving(true);
    void saveFeatures(next);
  };

  const removeClosedDate = (date: string) => {
    const next: AppFeatures = {
      ...features,
      closedDates: features.closedDates.filter((d) => d.date !== date),
    };
    setFeatures(next);
    setBookingSettingsSaving(true);
    void saveFeatures(next);
  };

  const formatClosedDate = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Features</h1>
        <p className="mt-1 text-text-secondary">Enable or disable optional workspace features.</p>
      </div>

      {featuresLoading ? (
        <div className="rounded-xl border border-surface-border bg-surface p-4 text-sm text-text-secondary">Loading...</div>
      ) : (
        <section className="space-y-4 rounded-xl border border-surface-border bg-surface p-4">
          <ToggleRow
            title="Accept bookings"
            description="When off, new booking requests will be added to the waitlist instead of creating a job."
            checked={features.bookingsEnabled}
            disabled={featuresSaving}
            onChange={(v) => setFeatureFlag("bookingsEnabled", v)}
          />
          <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground">Max active bikes</label>
                <p className="mt-0.5 text-xs text-text-secondary">
                  If the number of bikes in <span className="font-semibold">Received</span> +{" "}
                  <span className="font-semibold">Working on</span> meets or exceeds this limit, new requests go to the
                  waitlist. Use 0 for unlimited.
                </p>
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={maxActiveBikesInput}
                  disabled={featuresSaving}
                  onChange={(e) => {
                    setMaxActiveBikesInput(e.target.value);
                    setBookingDirty(true);
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && Number.isInteger(v)) {
                      setFeatures((p) => ({ ...p, maxActiveBikes: v }));
                    }
                  }}
                  className="mt-2 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div className="flex items-end justify-end">
                <button
                  type="button"
                  onClick={saveBookingSettings}
                  disabled={featuresSaving || !bookingDirty}
                  className={`h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${
                    featuresSaving || !bookingDirty
                      ? "cursor-not-allowed bg-surface-border text-text-muted"
                      : "bg-amber-600 text-white hover:bg-amber-700"
                  }`}
                >
                  Save booking settings
                </button>
              </div>
            </div>
            <div className="mt-4 border-t border-surface-border pt-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                <div>
                  <label className="block text-xs font-medium text-foreground">Closed date</label>
                  <input
                    type="date"
                    value={closedDateInput}
                    disabled={featuresSaving}
                    onChange={(e) => setClosedDateInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">Reason</label>
                  <input
                    type="text"
                    value={closedDateReasonInput}
                    maxLength={80}
                    disabled={featuresSaving}
                    onChange={(e) => setClosedDateReasonInput(e.target.value)}
                    placeholder="Holiday, staff training, inventory..."
                    className="mt-1 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={addClosedDate}
                    disabled={featuresSaving || !closedDateInput}
                    className={`h-10 w-full rounded-lg px-3 text-sm font-semibold transition-colors md:w-auto ${
                      featuresSaving || !closedDateInput
                        ? "cursor-not-allowed bg-surface-border text-text-muted"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    Add closed date
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {features.closedDates.length === 0 ? (
                  <p className="text-xs text-text-secondary">No closed dates set.</p>
                ) : (
                  features.closedDates.map((item) => (
                    <div
                      key={item.date}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-background px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{formatClosedDate(item.date)}</p>
                        {item.reason && <p className="text-xs text-text-secondary">{item.reason}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeClosedDate(item.date)}
                        disabled={featuresSaving || bookingSettingsSaving}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-text-muted dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <ToggleRow
            title="Collection service"
            description="Allow collection/pickup bookings and collection delivery type."
            checked={features.collectionServiceEnabled}
            disabled={featuresSaving}
            onChange={(v) => setFeatureFlag("collectionServiceEnabled", v)}
          />
          <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-foreground">Collection radius (miles)</label>
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={collectionRadiusInput}
                  disabled={featuresSaving}
                  onChange={(e) => {
                    setCollectionRadiusInput(e.target.value);
                    setCollectionDirty(true);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setFeatures((p) => ({ ...p, collectionRadiusMiles: n }));
                  }}
                  className="mt-1 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground">Collection fee (standard, $)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={0.01}
                  value={collectionFeeRegularInput}
                  disabled={featuresSaving}
                  onChange={(e) => {
                    setCollectionFeeRegularInput(e.target.value);
                    setCollectionDirty(true);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setFeatures((p) => ({ ...p, collectionFeeRegular: n }));
                  }}
                  className="mt-1 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground">Collection fee (e-bike, $)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={0.01}
                  value={collectionFeeEbikeInput}
                  disabled={featuresSaving}
                  onChange={(e) => {
                    setCollectionFeeEbikeInput(e.target.value);
                    setCollectionDirty(true);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setFeatures((p) => ({ ...p, collectionFeeEbike: n }));
                  }}
                  className="mt-1 w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={saveCollectionSettings}
                disabled={featuresSaving || !collectionDirty}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  featuresSaving || !collectionDirty
                    ? "cursor-not-allowed bg-surface-border text-text-muted"
                    : "bg-amber-600 text-white hover:bg-amber-700"
                }`}
              >
                Save collection settings
              </button>
            </div>
          </div>

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
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {featuresError}
                </div>
              )}
              {featuresSaved && !featuresError && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Saved.
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
