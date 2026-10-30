"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

type Loader = () => Promise<unknown>;

const AdminRefreshContext = createContext<Set<Loader> | null>(null);

/** Holds the client-side loaders of whichever admin tab is mounted. */
export function AdminRefreshProvider({ children }: { children: React.ReactNode }) {
  const loaders = useRef(new Set<Loader>());
  return (
    <AdminRefreshContext.Provider value={loaders.current}>{children}</AdminRefreshContext.Provider>
  );
}

/** Include a client panel's `load` in its tab's Refresh, using its current filters. */
export function useAdminRefreshLoader(load: Loader) {
  const loaders = useContext(AdminRefreshContext);

  useEffect(() => {
    if (!loaders) return;
    loaders.add(load);
    return () => {
      loaders.delete(load);
    };
  }, [loaders, load]);
}

/** Re-fetches the current tab in place: server-rendered data plus any registered loaders. */
export function AdminRefreshButton() {
  const router = useRouter();
  const loaders = useContext(AdminRefreshContext);
  const [loading, setLoading] = useState(false);
  const [routerPending, startTransition] = useTransition();
  const refreshing = loading || routerPending;

  const refresh = async () => {
    setLoading(true);
    startTransition(() => router.refresh());
    try {
      await Promise.all([...(loaders ?? [])].map((load) => load()));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={refreshing}
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 touch-manipulation"
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
      {refreshing ? "Refreshing…" : "Refresh"}
    </button>
  );
}
