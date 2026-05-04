"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, X } from "lucide-react";

type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
};

const DEFAULT_BRANDING: AppBranding = {
  logoUrl: null,
  logoAlt: "Bike Ops",
};

export default function BrandingSettingsPage() {
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_BRANDING);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Branding</h1>
        <p className="mt-1 text-text-secondary">Upload your business logo for staff, customer pages, and emails.</p>
      </div>

      <section className="rounded-xl border border-surface-border bg-surface p-4">
        {brandingLoading ? (
          <div className="text-sm text-text-secondary">Loading...</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-h-24 items-center justify-center rounded-lg border border-surface-border bg-subtle-bg px-6 py-4 sm:w-64">
                {branding.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={branding.logoUrl} alt={branding.logoAlt} className="max-h-20 max-w-full object-contain" />
                ) : (
                  <span className="text-sm text-text-muted">Bike Ops logo</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    brandingSaving ? "bg-surface-border text-text-muted" : "bg-amber-600 text-white hover:bg-amber-700"
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
                    className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg disabled:cursor-not-allowed disabled:opacity-50"
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
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {brandingError}
                  </div>
                )}
                {brandingSaved && !brandingError && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
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
