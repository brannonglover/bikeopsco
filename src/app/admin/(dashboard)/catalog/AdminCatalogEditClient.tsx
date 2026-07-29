"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BikeImageSearch } from "@/components/bikes/BikeImageSearch";

type SlotOption = {
  slot: string;
  label: string;
  groupTitle: string;
  visibility: string;
};

type ComponentRow = {
  slot: string;
  value: string;
  standard: string;
  detail: string;
  visibility: "VISUAL" | "INTERNAL" | "STANDARD";
};

type BikePayload = {
  id: string;
  model: string;
  family: string | null;
  year: number | null;
  category: string | null;
  subcategory: string | null;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  confidence: number;
  brand: { name: string };
  components: Array<{
    slot: string;
    value: string;
    standard: string | null;
    detail: string | null;
    visibility: "VISUAL" | "INTERNAL" | "STANDARD";
  }>;
};

function emptyRow(slot = "", visibility: ComponentRow["visibility"] = "VISUAL"): ComponentRow {
  return { slot, value: "", standard: "", detail: "", visibility };
}

export function AdminCatalogEditClient({ bikeId }: { bikeId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [brandName, setBrandName] = useState("");
  const [model, setModel] = useState("");
  const [family, setFamily] = useState("");
  const [year, setYear] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [confidence, setConfidence] = useState("1");
  const [components, setComponents] = useState<ComponentRow[]>([emptyRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const slotGroups = useMemo(() => {
    const map = new Map<string, SlotOption[]>();
    for (const slot of slots) {
      const list = map.get(slot.groupTitle) ?? [];
      list.push(slot);
      map.set(slot.groupTitle, list);
    }
    return [...map.entries()];
  }, [slots]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bikeRes, listRes] = await Promise.all([
        fetch(`/api/platform/catalog/bikes/${bikeId}`, { cache: "no-store" }),
        fetch("/api/platform/catalog/bikes", { cache: "no-store" }),
      ]);
      const bikeData = (await bikeRes.json().catch(() => null)) as {
        bike?: BikePayload;
        error?: string;
      } | null;
      const listData = (await listRes.json().catch(() => null)) as {
        slots?: SlotOption[];
      } | null;

      if (!bikeRes.ok || !bikeData?.bike) {
        setError(bikeData?.error ?? "Could not load bike");
        return;
      }

      const bike = bikeData.bike;
      setSlots(listData?.slots ?? []);
      setBrandName(bike.brand.name);
      setModel(bike.model);
      setFamily(bike.family ?? "");
      setYear(bike.year != null ? String(bike.year) : "");
      setCategory(bike.category ?? "");
      setSubcategory(bike.subcategory ?? "");
      setSourceUrl(bike.sourceUrl ?? "");
      setThumbnailUrl(bike.thumbnailUrl ?? "");
      setConfidence(String(bike.confidence ?? 1));
      setComponents(
        bike.components.length > 0
          ? bike.components.map((c) => ({
              slot: c.slot,
              value: c.value,
              standard: c.standard ?? "",
              detail: c.detail ?? "",
              visibility: c.visibility,
            }))
          : [emptyRow()]
      );
    } catch {
      setError("Could not load bike");
    } finally {
      setLoading(false);
    }
  }, [bikeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/bikes/upload", { method: "POST", body: formData });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Could not upload image");
        return;
      }
      setThumbnailUrl(data.url);
    } catch {
      setError("Could not upload image");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const yearNum = year.trim() ? Number(year) : null;
      const confidenceNum = Number(confidence);
      const res = await fetch(`/api/platform/catalog/bikes/${bikeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: brandName.trim(),
          model: model.trim(),
          family: family.trim() || null,
          year: Number.isFinite(yearNum as number) ? yearNum : null,
          category: category.trim() || null,
          subcategory: subcategory.trim() || null,
          sourceUrl: sourceUrl.trim() || null,
          thumbnailUrl: thumbnailUrl.trim() || null,
          confidence: Number.isFinite(confidenceNum) ? confidenceNum : 1,
          components: components
            .filter((c) => c.slot && c.value.trim())
            .map((c) => ({
              slot: c.slot,
              value: c.value.trim(),
              standard: c.standard.trim() || null,
              detail: c.detail.trim() || null,
              visibility: c.visibility,
            })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not save");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch {
      setError("Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeBike() {
    if (!window.confirm("Delete this catalog bike and all of its component specs?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/catalog/bikes/${bikeId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not delete");
        return;
      }
      router.push("/admin/catalog");
    } catch {
      setError("Could not delete");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading catalog bike…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/catalog" className="text-sm font-medium text-slate-700 hover:underline">
          ← Back to catalog
        </Link>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void removeBike()}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={saving || uploading}
            onClick={() => void save()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Saved at {savedAt}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Bike image</h2>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              className="h-28 w-28 rounded-xl object-cover border border-slate-200"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
              No image
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload photo"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFile(file);
                }}
              />
              <BikeImageSearch
                make={brandName}
                model={model}
                year={year}
                autoSearch={false}
                disabled={uploading || !brandName.trim() || !model.trim()}
                onSelect={(url) => setThumbnailUrl(url)}
                onBusyChange={setUploading}
              />
              {thumbnailUrl && (
                <button
                  type="button"
                  onClick={() => setThumbnailUrl("")}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600"
                >
                  Remove image
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Shown on Parts info when this catalog bike is matched. Prefer year-accurate photos.
              Remember to save after choosing an image.
            </p>
            <Field label="Image URL" value={thumbnailUrl} onChange={setThumbnailUrl} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Bike identity</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Brand" value={brandName} onChange={setBrandName} />
          <Field label="Model" value={model} onChange={setModel} />
          <Field label="Family" value={family} onChange={setFamily} />
          <Field label="Year" value={year} onChange={setYear} />
          <Field label="Category" value={category} onChange={setCategory} />
          <Field label="Subcategory" value={subcategory} onChange={setSubcategory} />
          <Field label="Source URL" value={sourceUrl} onChange={setSourceUrl} className="sm:col-span-2" />
          <Field label="Confidence (0–1)" value={confidence} onChange={setConfidence} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Component specs</h2>
          <button
            type="button"
            onClick={() => setComponents((rows) => [...rows, emptyRow()])}
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Add row
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {components.map((row, index) => (
            <div
              key={`${row.slot}-${index}`}
              className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3 lg:grid-cols-12"
            >
              <label className="lg:col-span-3">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Slot
                </span>
                <select
                  value={row.slot}
                  onChange={(e) => {
                    const slot = e.target.value;
                    const meta = slots.find((s) => s.slot === slot);
                    setComponents((rows) =>
                      rows.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              slot,
                              visibility:
                                (meta?.visibility as ComponentRow["visibility"]) ?? r.visibility,
                            }
                          : r
                      )
                    );
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                >
                  <option value="">Select slot…</option>
                  {slotGroups.map(([groupTitle, groupSlots]) => (
                    <optgroup key={groupTitle} label={groupTitle}>
                      {groupSlots.map((s) => (
                        <option key={s.slot} value={s.slot}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="lg:col-span-4">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Value
                </span>
                <input
                  value={row.value}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r))
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                />
              </label>
              <label className="lg:col-span-2">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Standard
                </span>
                <input
                  value={row.standard}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, standard: e.target.value } : r))
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                />
              </label>
              <label className="lg:col-span-2">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Visibility
                </span>
                <select
                  value={row.visibility}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r, i) =>
                        i === index
                          ? { ...r, visibility: e.target.value as ComponentRow["visibility"] }
                          : r
                      )
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                >
                  <option value="VISUAL">Visual</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="STANDARD">Standard</option>
                </select>
              </label>
              <div className="flex items-end lg:col-span-1">
                <button
                  type="button"
                  onClick={() => setComponents((rows) => rows.filter((_, i) => i !== index))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-white"
                >
                  Remove
                </button>
              </div>
              <label className="lg:col-span-12">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Detail / notes
                </span>
                <input
                  value={row.detail}
                  onChange={(e) =>
                    setComponents((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, detail: e.target.value } : r))
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
    </label>
  );
}
