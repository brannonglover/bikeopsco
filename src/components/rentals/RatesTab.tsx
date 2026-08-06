"use client";

import { useCallback, useEffect, useState } from "react";
import { CardsSkeleton, EmptyState, type RentalRateRow } from "@/components/rentals/shared";
import { Price } from "@/components/ui/Price";
import {
  RENTAL_CATEGORIES,
  RENTAL_CATEGORY_LABELS,
  type RentalCategory,
  toNumber,
} from "@/lib/rentals/types";

const emptyForm = {
  name: "",
  days: "1",
  price: "",
  category: "" as "" | RentalCategory,
  isActive: true,
};

export function RatesTab() {
  const [rates, setRates] = useState<RentalRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch("/api/rentals/rates")
      .then((res) => res.json())
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map(
          (r: RentalRateRow & { price?: unknown }) => ({
            ...r,
            price: toNumber(r.price),
          })
        );
        setRates(normalized);
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

  const startEdit = (rate: RentalRateRow) => {
    setEditingId(rate.id);
    setForm({
      name: rate.name,
      days: String(rate.days),
      price: String(rate.price),
      category: rate.category ?? "",
      isActive: rate.isActive,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.days || form.price === "") return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        days: parseInt(form.days, 10) || 1,
        price: parseFloat(form.price) || 0,
        category: form.category || null,
        isActive: form.isActive,
      };
      const res = await fetch(
        editingId ? `/api/rentals/rates/${editingId}` : "/api/rentals/rates",
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
    if (!confirm("Delete this rate?")) return;
    const res = await fetch(`/api/rentals/rates/${id}`, { method: "DELETE" });
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Rental Rates</h2>
          <p className="text-sm text-slate-500">
            Set the price for each rental duration (e.g. 1 day, 3 days, weekly).
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Add Rate
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
            {editingId ? "Edit rate" : "New rate"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                placeholder="1 Day / Weekend"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Days</span>
              <input
                type="number"
                min={1}
                value={form.days}
                onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
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
                placeholder="45.00"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Category</span>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as "" | RentalCategory,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">All categories</option>
                {RENTAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RENTAL_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <span className="text-slate-600 dark:text-slate-300">Active</span>
          </label>
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
        <CardsSkeleton count={6} />
      ) : rates.length === 0 ? (
        <EmptyState message="No rates yet. Add pricing for 1 day, multi-day, or weekly rentals." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rates.map((rate) => (
            <div
              key={rate.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{rate.name}</p>
                  <p className="text-sm text-slate-500">
                    {rate.days} day{rate.days === 1 ? "" : "s"}
                    {rate.category
                      ? ` · ${RENTAL_CATEGORY_LABELS[rate.category]}`
                      : " · All bikes"}
                  </p>
                </div>
                <Price amount={rate.price} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span
                  className={`text-xs font-semibold ${
                    rate.isActive ? "text-emerald-600" : "text-slate-400"
                  }`}
                >
                  {rate.isActive ? "Active" : "Inactive"}
                </span>
                <div>
                  <button
                    type="button"
                    onClick={() => startEdit(rate)}
                    className="mr-2 text-sm text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(rate.id)}
                    className="text-sm text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
