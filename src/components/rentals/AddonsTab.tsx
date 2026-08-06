"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, ListSkeleton, type RentalAddonRow } from "@/components/rentals/shared";
import { Price } from "@/components/ui/Price";
import { toNumber } from "@/lib/rentals/types";

const emptyForm = {
  name: "",
  description: "",
  price: "",
  stockQuantity: "0",
  isActive: true,
};

export function AddonsTab() {
  const [addons, setAddons] = useState<RentalAddonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch("/api/rentals/addons")
      .then((res) => res.json())
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map(
          (a: RentalAddonRow & { price?: unknown }) => ({
            ...a,
            price: toNumber(a.price),
          })
        );
        setAddons(normalized);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const startEdit = (addon: RentalAddonRow) => {
    setEditingId(addon.id);
    setForm({
      name: addon.name,
      description: addon.description ?? "",
      price: String(addon.price),
      stockQuantity: String(addon.stockQuantity),
      isActive: addon.isActive,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price) || 0,
        stockQuantity: parseInt(form.stockQuantity, 10) || 0,
        isActive: form.isActive,
      };
      const res = await fetch(
        editingId ? `/api/rentals/addons/${editingId}` : "/api/rentals/addons",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this add-on?")) return;
    const res = await fetch(`/api/rentals/addons/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to delete");
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add-ons</h2>
          <p className="text-sm text-slate-500">Helmets, locks, and other extras for rentals.</p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Add Add-on
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="Helmet"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Price ($)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Stock</span>
              <input
                type="number"
                min={0}
                value={form.stockQuantity}
                onChange={(e) => setForm((f) => ({ ...f, stockQuantity: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded border-slate-300"
              />
              <span className="text-slate-600 dark:text-slate-300">Active</span>
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-4">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Description</span>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={5} />
      ) : addons.length === 0 ? (
        <EmptyState message="No add-ons yet. Add helmets, locks, or other extras." />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {addons.map((addon) => (
            <li
              key={addon.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-slate-900/20"
            >
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{addon.name}</p>
                <p className="text-sm text-slate-500">
                  {addon.description || "No description"} · Stock {addon.stockQuantity}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Price amount={addon.price} />
                <button
                  type="button"
                  onClick={() => startEdit(addon)}
                  className="text-sm text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(addon.id)}
                  className="text-sm text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
