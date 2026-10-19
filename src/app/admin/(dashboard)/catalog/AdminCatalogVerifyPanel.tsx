"use client";

import { useCallback, useEffect, useState } from "react";

type SavedComponent = {
  slot: string;
  label: string;
  value: string;
  standard: string | null;
  source: "MANUFACTURER" | "THIRD_PARTY" | "ADMIN" | "APPROXIMATE";
  sourceUrl: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verifiedAgainst: string | null;
};

type SavedBike = {
  id: string;
  model: string;
  yearStart: number | null;
  yearEnd: number | null;
  sourceUrl: string | null;
  specStatus: "APPROXIMATE" | "SOURCED" | "VERIFIED";
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  brand: { name: string };
  components: SavedComponent[];
};

const SOURCE_LABELS: Record<SavedComponent["source"], string> = {
  MANUFACTURER: "Manufacturer page",
  THIRD_PARTY: "Third-party page",
  ADMIN: "Entered by admin",
  APPROXIMATE: "Approximate",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

/**
 * Deliberate verification of what's saved for this build: its identity, and
 * each part one by one, with what it was checked against. Unsaved edits above
 * aren't verified — save first.
 */
export function AdminCatalogVerifyPanel({
  bikeId,
  reloadKey,
  onChanged,
}: {
  bikeId: string;
  /** Bump to reload after the edit form saves. */
  reloadKey: number;
  onChanged: () => void;
}) {
  const [bike, setBike] = useState<SavedBike | null>(null);
  const [identity, setIdentity] = useState(false);
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/platform/catalog/bikes/${bikeId}`, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as { bike?: SavedBike } | null;
    if (res.ok && data?.bike) setBike(data.bike);
  }, [bikeId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/catalog/bikes/${bikeId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { bike?: SavedBike; error?: string } | null;
      if (!res.ok || !data?.bike) {
        setError(data?.error ?? "Could not record verification");
        return;
      }
      setBike(data.bike);
      setIdentity(false);
      setSlots(new Set());
      onChanged();
    } catch {
      setError("Could not record verification");
    } finally {
      setBusy(false);
    }
  };

  if (!bike) return null;
  const years =
    bike.yearStart == null
      ? "no year"
      : bike.yearEnd != null && bike.yearEnd !== bike.yearStart
        ? `${bike.yearStart}–${bike.yearEnd}`
        : String(bike.yearStart);
  const unverified = bike.components.filter((c) => !c.verifiedAt);
  const verifiedCount = bike.components.length - unverified.length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Verification</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
        Verifying records your name, the time, and what you checked against. <strong>Build</strong>{" "}
        means the brand, model, trim and years are right — it lets jobs match this row automatically,
        but says nothing about the parts. <strong>Part</strong> means you compared that exact value
        (and standard) with the source for this build and year. It confirms what came on the bike,
        not which replacement parts fit. Editing a verified value clears it. This checks what’s
        saved — save edits above first.
      </p>

      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-medium text-slate-800">
          {bike.brand.name} {bike.model} · {years}
        </p>
        {bike.specStatus === "VERIFIED" ? (
          <p className="mt-1 text-xs text-emerald-800">
            Build verified by {bike.verifiedBy} on {when(bike.verifiedAt)} — against: {bike.verificationNote}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit({ action: "withdraw", identity: true, slots: [] })}
              className="ml-2 font-semibold text-red-700 hover:underline disabled:opacity-50"
            >
              Withdraw
            </button>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-600">Build not verified.</p>
        )}
        <p className="mt-1 text-xs text-slate-600">
          {verifiedCount} of {bike.components.length} parts verified.
        </p>
      </div>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-500">
          Checked against (required) — a manufacturer page URL, or e.g. “Inspected the bike in the shop”
        </span>
        <input
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          placeholder={bike.sourceUrl ?? ""}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      </label>

      {bike.specStatus !== "VERIFIED" && (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={identity}
            onChange={(e) => setIdentity(e.target.checked)}
            aria-label="Brand, model, trim and years are correct"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>Brand, model, trim and years ({years}) are correct for this build sheet</span>
        </label>
      )}

      <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
        {bike.components.map((c) => (
          <li key={c.slot} className="flex items-start gap-2 py-2 text-sm">
            {c.verifiedAt ? (
              <span className="mt-0.5 w-4 text-emerald-600" aria-label="Verified">
                ✓
              </span>
            ) : (
              <input
                type="checkbox"
                checked={slots.has(c.slot)}
                onChange={(e) =>
                  setSlots((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.slot);
                    else next.delete(c.slot);
                    return next;
                  })
                }
                aria-label={`Verify ${c.label}`}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-slate-900">
                <span className="text-xs font-medium text-slate-500">{c.label}:</span> {c.value}
                {c.standard ? <span className="text-slate-500"> [{c.standard}]</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                {SOURCE_LABELS[c.source]}
                {c.sourceUrl && (
                  <>
                    {" · "}
                    <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                      {new URL(c.sourceUrl).hostname}
                    </a>
                  </>
                )}
                {c.verifiedAt && (
                  <>
                    {" · "}verified by {c.verifiedBy} on {when(c.verifiedAt)} against {c.verifiedAgainst}{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submit({ action: "withdraw", identity: false, slots: [c.slot] })}
                      className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {unverified.length > 1 && (
        <button
          type="button"
          onClick={() => setSlots(new Set(unverified.map((c) => c.slot)))}
          className="mt-2 text-xs font-semibold text-slate-600 hover:underline"
        >
          Select all unverified parts
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={busy || !basis.trim() || (!identity && slots.size === 0)}
        onClick={() => void submit({ action: "verify", identity, slots: [...slots], basis })}
        className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Record verification"}
      </button>
    </section>
  );
}
