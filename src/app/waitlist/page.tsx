"use client";

import { useEffect, useMemo, useState } from "react";

type WaitlistBike = {
  id: string;
  make: string;
  model: string | null;
  bikeType: "REGULAR" | "E_BIKE" | null;
};

type WaitlistEntry = {
  id: string;
  status: "WAITING" | "PROMOTED" | "CANCELLED";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string | null;
  deliveryType: "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE";
  customerNotes: string | null;
  createdAt: string;
  bikes: WaitlistBike[];
  serviceNames: string[];
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as WaitlistEntry[];
      setEntries(Array.isArray(data) ? data : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalBikesWaiting = useMemo(
    () => entries.reduce((sum, e) => sum + (e.bikes?.length ?? 0), 0),
    [entries]
  );

  const promote = async (id: string) => {
    setWorkingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/waitlist/${encodeURIComponent(id)}/promote`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to promote.");
        return;
      }
      await load();
    } catch {
      setError("Failed to promote.");
    } finally {
      setWorkingId(null);
    }
  };

  const cancel = async (id: string) => {
    setWorkingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/waitlist/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to cancel.");
        return;
      }
      await load();
    } catch {
      setError("Failed to cancel.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Waitlist</h1>
          <p className="text-text-secondary">
            {status === "ready"
              ? `${entries.length} request${entries.length === 1 ? "" : "s"} · ${totalBikesWaiting} bike${
                  totalBikesWaiting === 1 ? "" : "s"
                } waiting`
              : "Manage overflow booking requests."}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm font-semibold hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {status === "loading" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading…</div>
      )}
      {status === "error" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Failed to load waitlist.
        </div>
      )}
      {status === "ready" && entries.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No waitlist requests right now.
        </div>
      )}

      {status === "ready" && entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((e) => {
            const bikesLine =
              e.bikes.length === 1
                ? `${e.bikes[0].make}${e.bikes[0].model ? ` ${e.bikes[0].model}` : ""}`
                : `${e.bikes.length} bikes`;
            const servicesLine = e.serviceNames?.length ? e.serviceNames.join(", ") : "None specified";
            const disabled = workingId === e.id;

            return (
              <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-base font-semibold text-slate-900 truncate">
                        {e.firstName} {e.lastName}
                      </h2>
                      <span className="text-xs text-slate-500">{formatWhen(e.createdAt)}</span>
                      <span className="text-xs text-slate-500">· {e.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      <span className="font-semibold">Bikes:</span> {bikesLine}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      <span className="font-semibold">Services:</span> {servicesLine}
                    </p>
                    {e.customerNotes ? (
                      <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">
                        <span className="font-semibold text-slate-700">Notes:</span> {e.customerNotes}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500 truncate">
                      {e.email} · {e.phone}
                    </p>
                  </div>

                  <div className="flex flex-row sm:flex-col gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => promote(e.id)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        disabled
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      Promote
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => cancel(e.id)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        disabled
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

