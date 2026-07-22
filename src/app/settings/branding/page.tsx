"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, X } from "lucide-react";
import { formatPhoneInputUS, phoneToInputValue } from "@/lib/phone";

type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
  shopPhone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const DEFAULT_BRANDING: AppBranding = {
  logoUrl: null,
  logoAlt: "Bike Ops",
  shopPhone: null,
  address: null,
  latitude: null,
  longitude: null,
};

export default function BrandingSettingsPage() {
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_BRANDING);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [shopPhoneInput, setShopPhoneInput] = useState("");
  const [shopPhoneDirty, setShopPhoneDirty] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [addressDirty, setAddressDirty] = useState(false);

  const fetchBranding = useCallback(async () => {
    setBrandingError(null);
    setBrandingLoading(true);
    try {
      const res = await fetch("/api/settings/branding", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as Partial<AppBranding>;
      const next = { ...DEFAULT_BRANDING, ...data };
      setBranding(next);
      setShopPhoneInput(phoneToInputValue(next.shopPhone));
      setShopPhoneDirty(false);
      setAddressInput(next.address ?? "");
      setAddressDirty(false);
    } catch {
      setBrandingError("Failed to load branding.");
    } finally {
      setBrandingLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBranding();
  }, [fetchBranding]);

  const saveBranding = async (payload: {
    logoUrl?: string | null;
    shopPhone?: string | null;
    address?: string | null;
  }) => {
    setBrandingSaving(true);
    setBrandingSaved(false);
    setBrandingError(null);
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBrandingError(typeof data?.error === "string" ? data.error : "Failed to save branding.");
        return;
      }
      const next = { ...DEFAULT_BRANDING, ...(data as AppBranding) };
      setBranding(next);
      setShopPhoneInput(phoneToInputValue(next.shopPhone));
      setShopPhoneDirty(false);
      setAddressInput(next.address ?? "");
      setAddressDirty(false);
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
      await saveBranding({ logoUrl: uploadData.url });
    } catch {
      setBrandingError("Upload failed.");
    } finally {
      setBrandingSaving(false);
    }
  };

  const saveShopPhone = () => {
    void saveBranding({ shopPhone: shopPhoneInput.trim() || null });
  };

  const saveAddress = () => {
    void saveBranding({ address: addressInput.trim() || null });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Branding</h1>
        <p className="mt-1 text-text-secondary">
          Upload your business logo, set the public phone number, and add your shop
          address so customers can find you in nearby search.
        </p>
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
                    onClick={() => void saveBranding({ logoUrl: null })}
                    disabled={brandingSaving}
                    className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Use Bike Ops logo
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
              <label className="block text-sm font-semibold text-foreground">Shop phone</label>
              <p className="mt-0.5 text-sm text-text-secondary">
                Shown on customer job status so they can call the shop. Leave blank to hide the call button.
                This is separate from mechanic roster numbers.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={shopPhoneInput}
                  disabled={brandingSaving}
                  onChange={(e) => {
                    setShopPhoneInput(formatPhoneInputUS(e.target.value));
                    setShopPhoneDirty(true);
                  }}
                  placeholder="(555) 123-4567"
                  className="w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={saveShopPhone}
                    disabled={brandingSaving || !shopPhoneDirty}
                    className={`h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${
                      brandingSaving || !shopPhoneDirty
                        ? "cursor-not-allowed bg-surface-border text-text-muted"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    Save phone
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
              <label className="block text-sm font-semibold text-foreground">Shop address</label>
              <p className="mt-0.5 text-sm text-text-secondary">
                Used so customers can find your shop in nearby search in the mobile app.
                We geocode this to a map location when you save.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="text"
                  autoComplete="street-address"
                  value={addressInput}
                  disabled={brandingSaving}
                  onChange={(e) => {
                    setAddressInput(e.target.value);
                    setAddressDirty(true);
                  }}
                  placeholder="123 Main St, City, ST 12345"
                  className="w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={saveAddress}
                    disabled={brandingSaving || !addressDirty}
                    className={`h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${
                      brandingSaving || !addressDirty
                        ? "cursor-not-allowed bg-surface-border text-text-muted"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    Save address
                  </button>
                </div>
              </div>
              {branding.latitude != null && branding.longitude != null ? (
                <p className="mt-2 text-xs text-text-muted">
                  Mapped at {branding.latitude.toFixed(5)}, {branding.longitude.toFixed(5)}
                </p>
              ) : branding.address ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Address saved, but not mapped yet. Re-save once geocoding is available.
                </p>
              ) : null}
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
