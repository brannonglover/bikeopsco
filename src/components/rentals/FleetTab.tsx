"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, TableSkeleton, type RentalBikeRow } from "@/components/rentals/shared";
import {
  RENTAL_CATEGORIES,
  RENTAL_CATEGORY_LABELS,
  type RentalCategory,
} from "@/lib/rentals/types";

const emptyForm = {
  make: "",
  model: "",
  category: "MOUNTAIN" as RentalCategory,
  size: "",
  description: "",
  quantity: "1",
  isActive: true,
};

export function FleetTab() {
  const [bikes, setBikes] = useState<RentalBikeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    const url = query ? `/api/rentals/fleet?q=${encodeURIComponent(query)}` : "/api/rentals/fleet";
    fetch(url)
      .then((res) => res.json())
      .then((data) => setBikes(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const startEdit = (bike: RentalBikeRow) => {
    setEditingId(bike.id);
    setForm({
      make: bike.make,
      model: bike.model,
      category: bike.category,
      size: bike.size ?? "",
      description: bike.description ?? "",
      quantity: String(bike.quantity),
      isActive: bike.isActive,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.make.trim() || !form.model.trim()) return;
    setSaving(true);
    try {
      const payload = {
        make: form.make.trim(),
        model: form.model.trim(),
        category: form.category,
        size: form.size.trim() || null,
        description: form.description.trim() || null,
        quantity: parseInt(form.quantity, 10) || 1,
        isActive: form.isActive,
      };
      const res = await fetch(
        editingId ? `/api/rentals/fleet/${editingId}` : "/api/rentals/fleet",
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
      setForm(emptyForm);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this bike from the rental fleet?")) return;
    const res = await fetch(`/api/rentals/fleet/${id}`, { method: "DELETE" });
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Fleet</h2>
          <p className="text-sm text-slate-500">Add the bikes customers can rent from your shop.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fleet…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={startAdd}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Add Bike
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
            {editingId ? "Edit bike" : "Add bike to fleet"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Make</span>
              <input
                value={form.make}
                onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="Trek"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Model</span>
              <input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="Marlin 7"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Category</span>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value as RentalCategory }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              >
                {RENTAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RENTAL_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Size</span>
              <input
                value={form.size}
                onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="M / 17&quot;"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Quantity</span>
              <input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
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
              <span className="text-slate-600 dark:text-slate-300">Available for rent</span>
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Description</span>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="Optional notes"
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
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : bikes.length === 0 ? (
        <EmptyState message="No rental bikes yet. Add your first bike above." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/80">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Bike</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {bikes.map((bike) => (
                <tr key={bike.id} className="bg-white dark:bg-slate-900/20">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {bike.make} {bike.model}
                    </p>
                    {bike.description && (
                      <p className="text-xs text-slate-500">{bike.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {RENTAL_CATEGORY_LABELS[bike.category]}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {bike.size || "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                    {bike.quantity}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        bike.isActive
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {bike.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(bike)}
                      className="mr-2 text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(bike.id)}
                      className="text-red-600 hover:underline dark:text-red-400"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
