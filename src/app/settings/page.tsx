"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound, MessageSquareText, PhoneCall, ShieldCheck, Upload, X } from "lucide-react";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { broadcastAppFeaturesUpdated } from "@/contexts/AppFeaturesContext";

type AppFeatures = {
  bookingsEnabled: boolean;
  maxActiveBikes: number;
  collectionServiceEnabled: boolean;
  collectionRadiusMiles: number;
  collectionFeeRegular: number;
  collectionFeeEbike: number;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
};

const DEFAULT_FEATURES: AppFeatures = {
  bookingsEnabled: true,
  maxActiveBikes: 5,
  collectionServiceEnabled: true,
  collectionRadiusMiles: 5,
  collectionFeeRegular: 20,
  collectionFeeEbike: 30,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

const DEFAULT_BRANDING: AppBranding = {
  logoUrl: null,
  logoAlt: "Bike Ops",
};

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use the light colour scheme" },
  { value: "dark", label: "Dark", description: "Always use the dark colour scheme" },
  { value: "system", label: "System", description: "Follow your device settings" },
];

const INFOBIP_SETUP_STEPS = [
  {
    title: "Create and verify the Infobip account",
    description:
      "Sign up with the legal business name, billing details, service country, and a monitored admin email. Send a first test SMS from Infobip before connecting it to Bike Ops.",
  },
  {
    title: "Buy or register an SMS sender",
    description:
      "Use a leased SMS number when customers need to reply in chat. A branded sender name can work for one-way updates, but replies and STOP/START handling require a real number.",
  },
  {
    title: "Create an API key",
    description:
      "Create a restricted API key for Bike Ops with SMS sending access. Store it somewhere secure; Infobip only shows the full secret when the key is created.",
  },
  {
    title: "Add inbound forwarding",
    description:
      "Configure the SMS number to push inbound messages to the Bike Ops webhook URL for your workspace so customer replies appear in Chat.",
  },
  {
    title: "Run a live test",
    description:
      "Send a booking or job-status test to an opted-in customer number, reply to it from the phone, then confirm the reply appears in Bike Ops Chat.",
  },
] as const;

const INFOBIP_ENV_VARS = [
  {
    name: "INFOBIP_BASE_URL",
    detail: "Your Infobip API base URL, for example https://xxxxx.api.infobip.com, without a trailing slash.",
  },
  {
    name: "INFOBIP_API_KEY",
    detail: "The API key value generated for Bike Ops. Treat this like a password.",
  },
  {
    name: "INFOBIP_SENDER",
    detail: "The SMS number or sender ID Bike Ops should send from. Use the number format Infobip shows for the resource.",
  },
  {
    name: "INFOBIP_WEBHOOK_SECRET",
    detail: "Optional shared secret used to reject unknown inbound webhook calls.",
  },
] as const;

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
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_BRANDING);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [maxActiveBikesInput, setMaxActiveBikesInput] = useState(String(DEFAULT_FEATURES.maxActiveBikes));
  const [bookingDirty, setBookingDirty] = useState(false);
  const [collectionRadiusInput, setCollectionRadiusInput] = useState(String(DEFAULT_FEATURES.collectionRadiusMiles));
  const [collectionFeeRegularInput, setCollectionFeeRegularInput] = useState(String(DEFAULT_FEATURES.collectionFeeRegular));
  const [collectionFeeEbikeInput, setCollectionFeeEbikeInput] = useState(String(DEFAULT_FEATURES.collectionFeeEbike));
  const [collectionDirty, setCollectionDirty] = useState(false);

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
    } catch {
      setFeaturesError("Failed to load settings.");
    } finally {
      setFeaturesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const fetchBranding = useCallback(async () => {
    setBrandingError(null);
    setBrandingLoading(true);
    try {
      const res = await fetch("/api/settings/branding", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as Partial<AppBranding>;
      setBranding({ ...DEFAULT_BRANDING, ...data });
    } catch {
      setBrandingError("Failed to load branding.");
    } finally {
      setBrandingLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBranding();
  }, [fetchBranding]);

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

  const saveBranding = async (logoUrl: string | null) => {
    setBrandingSaving(true);
    setBrandingSaved(false);
    setBrandingError(null);
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBrandingError(typeof data?.error === "string" ? data.error : "Failed to save branding.");
        return;
      }
      setBranding({ ...DEFAULT_BRANDING, ...(data as AppBranding) });
      setBrandingSaved(true);
      window.setTimeout(() => setBrandingSaved(false), 1500);
      window.dispatchEvent(new Event("bikeops:branding-updated"));
    } catch {
      setBrandingError("Failed to save branding.");
    } finally {
      setBrandingSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setBrandingSaving(true);
    setBrandingSaved(false);
    setBrandingError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/settings/branding/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || typeof uploadData?.url !== "string") {
        setBrandingError(typeof uploadData?.error === "string" ? uploadData.error : "Upload failed.");
        return;
      }
      await saveBranding(uploadData.url);
    } catch {
      setBrandingError("Upload failed.");
    } finally {
      setBrandingSaving(false);
    }
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
          <h2 className="text-xl font-bold text-foreground mb-1">Branding</h2>
          <p className="text-text-secondary">Upload your business logo for staff, customer pages, and emails.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {brandingLoading ? (
            <div className="text-sm text-slate-600">Loading…</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-6 py-4 sm:w-64">
                  {branding.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={branding.logoUrl}
                      alt={branding.logoAlt}
                      className="max-h-20 max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-sm text-slate-500">Bike Ops logo</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      brandingSaving
                        ? "bg-slate-200 text-slate-500"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    Upload logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      className="sr-only"
                      disabled={brandingSaving}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void uploadLogo(file);
                      }}
                    />
                  </label>
                  {branding.logoUrl && (
                    <button
                      type="button"
                      onClick={() => void saveBranding(null)}
                      disabled={brandingSaving}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden />
                      Use Bike Ops logo
                    </button>
                  )}
                </div>
              </div>

              {(brandingError || brandingSaved) && (
                <div>
                  {brandingError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {brandingError}
                    </div>
                  )}
                  {brandingSaved && !brandingError && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      Saved.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
              title="Accept bookings"
              description="When off, new booking requests will be added to the waitlist instead of creating a job."
              checked={features.bookingsEnabled}
              disabled={featuresSaving}
              onChange={(v) => setFeatureFlag("bookingsEnabled", v)}
            />
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Max active bikes</label>
                  <p className="mt-0.5 text-xs text-slate-500">
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
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={saveBookingSettings}
                    disabled={featuresSaving || !bookingDirty}
                    className={`h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${
                      featuresSaving || !bookingDirty
                        ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    Save booking settings
                  </button>
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
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Collection radius (miles)</label>
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
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Collection fee (standard, $)</label>
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
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Collection fee (e-bike, $)</label>
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
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
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
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
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

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Infobip SMS setup</h2>
          <p className="text-sm text-slate-600">
            Connect a shop-owned Infobip account so Bike Ops can send service texts and receive customer replies.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <MessageSquareText className="h-5 w-5 text-amber-600" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold text-slate-900">Service SMS</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Sends booking confirmations, repair updates, payment links, reminders, and chat nudges.
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <PhoneCall className="h-5 w-5 text-amber-600" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold text-slate-900">Two-way replies</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Inbound SMS forwarding lets customer replies land in the Bike Ops chat inbox.
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <ShieldCheck className="h-5 w-5 text-amber-600" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold text-slate-900">Consent aware</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Bike Ops respects customer SMS consent and handles STOP, START, and HELP replies.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            Infobip credentials are configured by the Bike Ops workspace admin today. Do not paste API keys into chat or
            email unless your team has a secure handoff process.
          </div>

          <div className="mt-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Setup checklist</h3>
            <ol className="space-y-3">
              {INFOBIP_SETUP_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{step.title}</span>
                    <span className="block text-sm leading-6 text-slate-600">{step.description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-slate-700" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-900">Values Bike Ops needs</h3>
              </div>
              <dl className="mt-3 space-y-3">
                {INFOBIP_ENV_VARS.map((item) => (
                  <div key={item.name}>
                    <dt className="font-mono text-xs font-semibold text-slate-900">{item.name}</dt>
                    <dd className="mt-0.5 text-xs leading-5 text-slate-600">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Inbound webhook</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Set the forwarding method to HTTP POST and use this URL, replacing the host with the shop workspace:
              </p>
              <code className="mt-3 block break-all rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
                https://yourshop.bikeops.co/api/webhooks/infobip/sms?secret=your-secret
              </code>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                If Infobip lets you add custom headers instead, send the same secret as{" "}
                <span className="font-mono">x-webhook-secret</span>. Use HTTPS only.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href="https://www.infobip.com/docs/sms/get-started/send-test-message"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Test SMS guide
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <a
              href="https://www.infobip.com/docs/essentials/api-essentials/api-authorization"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              API key scopes
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <a
              href="https://www.infobip.com/docs/numbers"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Numbers setup
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
