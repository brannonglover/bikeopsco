"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  ListSkeleton,
  StatusBadge,
  type RentalBikeRow,
  type RentalReservationRow,
} from "@/components/rentals/shared";
import { Price } from "@/components/ui/Price";
import { resolveRentalPrice } from "@/lib/rentals/pricing";
import {
  formatDateRange,
  initials,
  RENTAL_STATUSES,
  RENTAL_STATUS_LABELS,
  rentalDaysBetween,
  parseDateOnly,
  toNumber,
  type RentalReservationStatus,
} from "@/lib/rentals/types";

type CustomerOption = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

type RateOption = {
  days: number;
  price: number;
  category: RentalBikeRow["category"] | null;
  isActive: boolean;
};

export function NewReservationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [bikes, setBikes] = useState<RentalBikeRow[]>([]);
  const [rates, setRates] = useState<RateOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    rentalBikeId: "",
    startDate: "",
    endDate: "",
    pickupTime: "9:00 AM",
    status: "CONFIRMED" as RentalReservationStatus,
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/rentals/fleet").then((r) => r.json()),
      fetch("/api/rentals/rates").then((r) => r.json()),
    ]).then(([fleet, rateRows]) => {
      setBikes((Array.isArray(fleet) ? fleet : []).filter((b: RentalBikeRow) => b.isActive));
      setRates(
        (Array.isArray(rateRows) ? rateRows : []).map((r: RateOption & { price?: unknown }) => ({
          days: r.days,
          price: toNumber(r.price),
          category: r.category,
          isActive: r.isActive,
        }))
      );
    });
  }, [open]);

  useEffect(() => {
    if (!open || customerQuery.trim().length < 2) {
      setCustomers([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(customerQuery.trim())}`)
        .then((r) => r.json())
        .then((data) => setCustomers(Array.isArray(data) ? data.slice(0, 8) : []));
    }, 200);
    return () => clearTimeout(t);
  }, [customerQuery, open]);

  const selectedBike = bikes.find((b) => b.id === form.rentalBikeId);

  const pricing = useMemo(() => {
    if (!form.startDate || !form.endDate) return null;
    try {
      const days = rentalDaysBetween(parseDateOnly(form.startDate), parseDateOnly(form.endDate));
      const resolved = resolveRentalPrice(rates, days, selectedBike?.category ?? null);
      return { days, resolved };
    } catch {
      return null;
    }
  }, [form.startDate, form.endDate, rates, selectedBike?.category]);

  const pickCustomer = (c: CustomerOption) => {
    setForm((f) => ({
      ...f,
      customerId: c.id,
      customerName: [c.firstName, c.lastName].filter(Boolean).join(" "),
      customerEmail: c.email ?? "",
      customerPhone: c.phone ?? "",
    }));
    setCustomerQuery("");
    setCustomers([]);
  };

  const submit = async () => {
    if (!form.customerName.trim() || !form.rentalBikeId || !form.startDate || !form.endDate) {
      alert("Customer name, bike, and dates are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/rentals/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId || null,
          customerName: form.customerName.trim(),
          customerEmail: form.customerEmail.trim() || null,
          customerPhone: form.customerPhone.trim() || null,
          rentalBikeId: form.rentalBikeId,
          startDate: form.startDate,
          endDate: form.endDate,
          pickupTime: form.pickupTime.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create reservation");
        return;
      }
      onCreated();
      onClose();
      setForm({
        customerId: "",
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        rentalBikeId: "",
        startDate: "",
        endDate: "",
        pickupTime: "9:00 AM",
        status: "CONFIRMED",
        notes: "",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            New Reservation
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">
              Customer (search or type name)
            </span>
            <input
              value={form.customerName}
              onChange={(e) => {
                setForm((f) => ({ ...f, customerName: e.target.value, customerId: "" }));
                setCustomerQuery(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              placeholder="Daniel Carter"
            />
            {customers.length > 0 && (
              <ul className="mt-1 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                {customers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                      {c.email ? ` · ${c.email}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Email</span>
              <input
                value={form.customerEmail}
                onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Phone</span>
              <input
                value={form.customerPhone}
                onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Bike</span>
            <select
              value={form.rentalBikeId}
              onChange={(e) => setForm((f) => ({ ...f, rentalBikeId: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="">Select a bike…</option>
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.make} {b.model}
                  {b.size ? ` (${b.size})` : ""} · {b.quantity} available
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Start date</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">End date</span>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Pickup time</span>
              <input
                value={form.pickupTime}
                onChange={(e) => setForm((f) => ({ ...f, pickupTime: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                placeholder="9:00 AM"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600 dark:text-slate-300">Status</span>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as RentalReservationStatus,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              >
                {RENTAL_STATUSES.filter((s) => s !== "COMPLETED" && s !== "CANCELLED").map(
                  (s) => (
                    <option key={s} value={s}>
                      {RENTAL_STATUS_LABELS[s]}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>

          {pricing && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
              <span className="font-medium text-emerald-900 dark:text-emerald-200">
                {pricing.days} day{pricing.days === 1 ? "" : "s"}
              </span>
              {pricing.resolved ? (
                <span className="text-emerald-800 dark:text-emerald-300">
                  {" "}
                  · Total <Price amount={pricing.resolved.totalPrice} variant="inline" />
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  {" "}
                  · No matching rate — add rates first
                </span>
              )}
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Reservation"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReservationsTab({
  openNew,
  onOpenNewConsumed,
}: {
  openNew?: boolean;
  onOpenNewConsumed?: () => void;
}) {
  const [rows, setRows] = useState<RentalReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/rentals/reservations")
      .then((res) => res.json())
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map(
          (r: RentalReservationRow & { totalPrice?: unknown; unitPrice?: unknown }) => ({
            ...r,
            totalPrice: toNumber(r.totalPrice),
            unitPrice: toNumber(r.unitPrice),
          })
        );
        setRows(normalized);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (openNew) {
      setModalOpen(true);
      onOpenNewConsumed?.();
    }
  }, [openNew, onOpenNewConsumed]);

  const updateStatus = async (id: string, status: RentalReservationStatus) => {
    const res = await fetch(`/api/rentals/reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to update");
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Reservations
          </h2>
          <p className="text-sm text-slate-500">All rental bookings for your shop.</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + New Reservation
        </button>
      </div>

      {loading ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState message="No reservations yet. Create one to get started." />
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-900/20"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  {initials(r.customerName)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {r.customerName}
                    </p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="truncate text-sm text-slate-500">
                    {r.rentalBike
                      ? `${r.rentalBike.make} ${r.rentalBike.model}`
                      : "Bike"}{" "}
                    · {formatDateRange(r.startDate, r.endDate)} ({r.days} day
                    {r.days === 1 ? "" : "s"})
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <Price amount={r.totalPrice} />
                <select
                  value={r.status}
                  onChange={(e) =>
                    updateStatus(r.id, e.target.value as RentalReservationStatus)
                  }
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  {RENTAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {RENTAL_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewReservationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={load}
      />
    </div>
  );
}
