"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppFeatures = {
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

const AppFeaturesContext = createContext<AppFeatures>(DEFAULTS);

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

  const value = useMemo(() => features, [features]);
  return <AppFeaturesContext.Provider value={value}>{children}</AppFeaturesContext.Provider>;
}

export function useAppFeatures(): AppFeatures {
  return useContext(AppFeaturesContext);
}

