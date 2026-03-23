"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Price } from "@/components/ui/Price";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

const BASE = typeof window !== "undefined" ? "" : process.env.NEXT_PUBLIC_APP_URL || "";

function getDefaultDropOffDateTime(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T09:00`;
}

function BookForm() {
  const searchParams = useSearchParams();
  const embed = searchParams?.get("embed") === "1";

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string; statusUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    bikeMake: "",
    bikeModel: "",
    deliveryType: "DROP_OFF_AT_SHOP" as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
    dropOffDate: getDefaultDropOffDateTime(),
    pickupDate: "",
    collectionAddress: "",
    customerNotes: "",
    serviceIds: [] as string[],
  });

  useEffect(() => {
    fetch(`${BASE}/api/widget/services`)
      .then((res) => res.json())
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, []);

  const toggleService = (id: string) => {
    setForm((p) => ({
      ...p,
      serviceIds: p.serviceIds.includes(id)
        ? p.serviceIds.filter((s) => s !== id)
        : [...p.serviceIds, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${BASE}/api/widget/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || null,
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          bikeMake: form.bikeMake.trim(),
          bikeModel: form.bikeModel.trim(),
          deliveryType: form.deliveryType,
          dropOffDate: form.dropOffDate || null,
          pickupDate: form.pickupDate || null,
          collectionAddress:
            form.deliveryType === "COLLECTION_SERVICE" ? form.collectionAddress.trim() || null : null,
          customerNotes: form.customerNotes.trim() || null,
          serviceIds: form.serviceIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setSuccess({ id: data.id, statusUrl: data.statusUrl || `${BASE}/status/${data.id}` });
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "bikeops-booking-complete", jobId: data.id }, "*");
    }
    } catch {
      setError("Could not submit. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="text-center">
          <span className="text-4xl" aria-hidden>
            ✓
          </span>
          <h2 className="mt-2 text-xl font-bold text-slate-900">Booking confirmed!</h2>
          <p className="mt-1 text-slate-600">
            Check your email for confirmation. You can track your repair status below.
          </p>
        </div>
        <a
          href={success.statusUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-xl bg-amber-500 px-4 py-3 text-center font-semibold text-white hover:bg-amber-600 transition-colors"
        >
          Track your repair status
        </a>
        {embed && (
          <p className="text-center text-xs text-slate-500">
            You can close this window.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`mx-auto max-w-lg min-w-0 overflow-x-hidden ${embed ? "p-4" : "p-6"}`}>
      <h1 className={`font-bold text-slate-900 ${embed ? "text-lg" : "text-2xl mb-6"}`}>
        Book a repair
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4 contain-overflow min-w-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              First name *
            </label>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
              className="input-book"
              placeholder="John"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Last name</label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
              className="input-book"
              placeholder="Smith"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email *</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className="input-book"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className="input-book"
            placeholder="(555) 123-4567"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bike make *
            </label>
            <input
              type="text"
              required
              value={form.bikeMake}
              onChange={(e) => setForm((p) => ({ ...p, bikeMake: e.target.value }))}
              className="input-book"
              placeholder="Trek, Specialized..."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bike model *
            </label>
            <input
              type="text"
              required
              value={form.bikeModel}
              onChange={(e) => setForm((p) => ({ ...p, bikeModel: e.target.value }))}
              className="input-book"
              placeholder="Domane SL 6"
            />
          </div>
        </div>

        {services.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Services (optional)
            </label>
            <div className="max-h-32 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
              {services.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={form.serviceIds.includes(s.id)}
                    onChange={() => toggleService(s.id)}
                    className="rounded border-slate-200 text-amber-600 focus:ring-amber-500/20"
                  />
                  <span className="flex-1 text-sm font-medium text-slate-800">{s.name}</span>
                  <Price amount={s.price} variant="inline" />
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Delivery option
          </label>
          <select
            value={form.deliveryType}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                deliveryType: e.target.value as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
              }))
            }
            className="input-book"
          >
            <option value="DROP_OFF_AT_SHOP">Drop-off at shop</option>
            <option value="COLLECTION_SERVICE">Collection service</option>
          </select>
        </div>

        {form.deliveryType === "COLLECTION_SERVICE" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Collection address
            </label>
            <input
              type="text"
              value={form.collectionAddress}
              onChange={(e) => setForm((p) => ({ ...p, collectionAddress: e.target.value }))}
              className="input-book"
              placeholder="Street, city, postal code"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Preferred drop-off date
            </label>
            <input
              type="datetime-local"
              value={form.dropOffDate}
              onChange={(e) => setForm((p) => ({ ...p, dropOffDate: e.target.value }))}
              className="input-book"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Preferred pickup date
            </label>
            <input
              type="datetime-local"
              value={form.pickupDate}
              onChange={(e) => setForm((p) => ({ ...p, pickupDate: e.target.value }))}
              className="input-book"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Any additional info
          </label>
          <textarea
            rows={3}
            value={form.customerNotes}
            onChange={(e) => setForm((p) => ({ ...p, customerNotes: e.target.value }))}
            className="input-book"
            placeholder="Anything else we should know?"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-amber-500 py-3 font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Booking..." : "Book repair"}
        </button>
      </form>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[320px] items-center justify-center p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
      </div>
    }>
      <BookForm />
    </Suspense>
  );
}
