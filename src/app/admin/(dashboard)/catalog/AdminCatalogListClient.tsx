"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TableSkeleton } from "@/components/ui/Skeleton";

type SlotOption = {
  slot: string;
  label: string;
  groupTitle: string;
  visibility: string;
};

type CatalogBikeRow = {
  id: string;
  brandName: string;
  model: string;
  family: string | null;
  year: number | null;
  category: string | null;
  componentCount: number;
  confidence: number;
  updatedAt: string;
  thumbnailUrl: string | null;
};

type BrandOption = { id: string; name: string; slug: string };

export function AdminCatalogListClient() {
  const router = useRouter();
  const [bikes, setBikes] = useState<CatalogBikeRow[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newYear, setNewYear] = useState("");
  const [saving, setSaving] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (brand.trim()) params.set("brand", brand.trim());
    if (year.trim()) params.set("year", year.trim());
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [q, brand, year]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/catalog/bikes${queryString}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as {
        bikes?: CatalogBikeRow[];
        brands?: BrandOption[];
        slots?: SlotOption[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not load catalog");
        setBikes([]);
        return;
      }
      setBikes(data?.bikes ?? []);
      setBrands(data?.brands ?? []);
      setSlots(data?.slots ?? []);
    } catch {
      setError("Could not load catalog");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createBike() {
    if (!newBrand.trim() || !newModel.trim()) {
      setError("Brand and model are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const yearNum = newYear.trim() ? Number(newYear) : null;
      const res = await fetch("/api/platform/catalog/bikes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: newBrand.trim(),
          model: newModel.trim(),
          year: Number.isFinite(yearNum) ? yearNum : null,
          components: [],
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        bike?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.bike?.id) {
        setError(data?.error ?? "Could not create bike");
        return;
      }
      router.push(`/admin/catalog/${data.bike.id}`);
    } catch {
      setError("Could not create bike");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Make, model, family…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Brand</span>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Year</span>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2005"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {loading ? "Loading…" : `${bikes.length} bike${bikes.length === 1 ? "" : "s"}`}
          {slots.length > 0 ? ` · ${slots.length} component slots` : null}
        </p>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {creating ? "Cancel" : "Add bike"}
        </button>
      </div>

      {creating && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">New catalog bike</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              placeholder="Brand"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="Model"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              placeholder="Year"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void createBike()}
            className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create & edit specs"}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} cols={4} label="Loading catalog" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Bike</th>
                <th className="px-4 py-2.5 font-medium">Year</th>
                <th className="px-4 py-2.5 font-medium">Parts</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bikes.map((bike) => (
                <tr key={bike.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {bike.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={bike.thumbnailUrl}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-400">
                          No img
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/admin/catalog/${bike.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {bike.brandName} {bike.model}
                        </Link>
                        {bike.family && (
                          <p className="text-xs text-slate-500">{bike.family}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{bike.year ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-700">{bike.componentCount}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(bike.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {bikes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No catalog bikes match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
