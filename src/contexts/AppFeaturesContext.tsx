"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppFeatures = {
  collectionServiceEnabled: boolean;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

const APP_FEATURES_UPDATED_EVENT = "bikeops:app-features-updated";

const DEFAULTS: AppFeatures = {
  collectionServiceEnabled: true,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

const AppFeaturesContext = createContext<AppFeatures>(DEFAULTS);

export function broadcastAppFeaturesUpdated(features: Partial<AppFeatures>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_FEATURES_UPDATED_EVENT, { detail: features }));
}

export function AppFeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<AppFeatures>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/app-features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFeatures({ ...DEFAULTS, ...(data as Partial<AppFeatures>) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<Partial<AppFeatures>>;
      const next = custom.detail ?? {};
      setFeatures((prev) => ({ ...prev, ...next }));
    };
    window.addEventListener(APP_FEATURES_UPDATED_EVENT, handler);
    return () => window.removeEventListener(APP_FEATURES_UPDATED_EVENT, handler);
  }, []);

  const value = useMemo(() => features, [features]);
  return <AppFeaturesContext.Provider value={value}>{children}</AppFeaturesContext.Provider>;
}

export function useAppFeatures(): AppFeatures {
  return useContext(AppFeaturesContext);
}
