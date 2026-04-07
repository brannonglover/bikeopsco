"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { Price } from "@/components/ui/Price";
import { formatPhoneInputUS } from "@/lib/phone";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

type BikeEntry = {
  make: string;
  model: string;
  bikeType: "AUTO" | "REGULAR" | "E_BIKE";
};

const BASE = typeof window !== "undefined" ? "" : process.env.NEXT_PUBLIC_APP_URL || "";

const SHOP_DISPLAY_NAME =
  process.env.NEXT_PUBLIC_SHOP_NAME ?? "Basement Bike Mechanic";

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

  const [serviceSearch, setServiceSearch] = useState("");
  const [bikes, setBikes] = useState<BikeEntry[]>([{ make: "", model: "", bikeType: "AUTO" }]);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    deliveryType: "DROP_OFF_AT_SHOP" as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
    dropOffDate: getDefaultDropOffDateTime(),
    pickupDate: "",
    collectionAddress: "",
    collectionWindowStart: "",
    collectionWindowEnd: "",
    customerNotes: "",
    serviceIds: [] as string[],
    smsConsent: false,
  });

  const addBike = () => setBikes((p) => [...p, { make: "", model: "", bikeType: "AUTO" }]);
  const removeBike = (i: number) => setBikes((p) => p.filter((_, idx) => idx !== i));
  const updateBike = (i: number, field: keyof BikeEntry, value: string) =>
    setBikes((p) => p.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));

  useEffect(() => {
    fetch(`${BASE}/api/widget/services`)
      .then((res) => res.json())
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, []);

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false)
    );
  }, [services, serviceSearch]);

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
    if (!form.smsConsent) {
      setError("Please agree to SMS notifications to continue.");
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch(`${BASE}/api/widget/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          smsConsent: true,
          address: form.address.trim() || null,
          bikes: bikes.map((b) => ({
            make: b.make.trim(),
            model: b.model.trim(),
            bikeType: b.bikeType === "AUTO" ? undefined : b.bikeType,
          })),
          deliveryType: form.deliveryType,
          dropOffDate: form.dropOffDate || null,
          pickupDate: form.pickupDate || null,
          collectionAddress:
            form.deliveryType === "COLLECTION_SERVICE" ? form.collectionAddress.trim() || null : null,
          collectionWindowStart:
            form.deliveryType === "COLLECTION_SERVICE" ? form.collectionWindowStart || null : null,
          collectionWindowEnd:
            form.deliveryType === "COLLECTION_SERVICE" ? form.collectionWindowEnd || null : null,
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
    } catch {
      setError("Could not submit. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center p-6">
        <BikeLoader label="Loading booking options…" />
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
          <h2 className="mt-2 text-xl font-bold text-slate-900">Request submitted!</h2>
          <p className="mt-1 text-slate-600">
            We&apos;ll review your booking and email you once it&apos;s confirmed.
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
        <p className="text-center text-xs text-slate-500">
          You&apos;ll get an email when your booking is confirmed.
        </p>
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
            <label className="mb-1 block text-sm font-medium text-slate-700">Last name *</label>
            <input
              type="text"
              required
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
          <label className="mb-1 block text-sm font-medium text-slate-700">Phone *</label>
          <input
            type="tel"
            required
            value={form.phone}
            onChange={(e) =>
              setForm((p) => ({ ...p, phone: formatPhoneInputUS(e.target.value) }))
            }
            className="input-book"
            placeholder="(555) 123-4567"
            autoComplete="tel"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <label className="flex cursor-pointer gap-3">
            <input
              type="checkbox"
              checked={form.smsConsent}
              onChange={(e) =>
                setForm((p) => ({ ...p, smsConsent: e.target.checked }))
              }
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-amber-600 focus:ring-amber-500/20"
              required
            />
            <span className="text-sm leading-snug text-slate-700">
              I agree to receive SMS from <strong>{SHOP_DISPLAY_NAME}</strong> about my
              repair, including status updates and service-related messages. No marketing.
              Message frequency varies. Message &amp; data rates may apply. Reply{" "}
              <strong>STOP</strong> to opt out, <strong>HELP</strong> for help.
            </span>
          </label>
        </div>

        <div className="space-y-3">
          {bikes.map((bike, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {bikes.length > 1 ? `Bike ${i + 1}` : "Bike"}
                </span>
                {bikes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBike(i)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Make *</label>
                  <input
                    type="text"
                    required
                    value={bike.make}
                    onChange={(e) => updateBike(i, "make", e.target.value)}
                    className="input-book"
                    placeholder="Trek, Specialized..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Model *</label>
                  <input
                    type="text"
                    required
                    value={bike.model}
                    onChange={(e) => updateBike(i, "model", e.target.value)}
                    className="input-book"
                    placeholder="Domane SL 6"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
                <select
                  value={bike.bikeType}
                  onChange={(e) => updateBike(i, "bikeType", e.target.value)}
                  className="input-book"
                >
                  <option value="AUTO">Auto (from make/model)</option>
                  <option value="REGULAR">Standard bike</option>
                  <option value="E_BIKE">E-bike</option>
                </select>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addBike}
            className="w-full rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-amber-400 hover:text-amber-600 transition-colors"
          >
            + Add another bike
          </button>
          <p className="text-xs text-slate-500">
            For collection service, we charge $20 pickup/dropoff within 5 mi for a standard bike and $30 for an e-bike. Auto uses your make/model to guess.
          </p>
        </div>

        {services.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Services (optional)
            </label>
            <input
              type="text"
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              placeholder="Search services..."
              className="input-book mb-2"
            />
            <div className="max-h-[9.5rem] space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
              {filteredServices.map((s) => (
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
              {filteredServices.length === 0 && (
                <p className="py-2 text-sm text-slate-500">No services match your search</p>
              )}
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
            <p className="mt-2 text-xs text-slate-500">
              Pickup/dropoff within 5 miles of the shop; fee is added automatically when your booking is accepted.
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Preferred collection window
              </label>
              <p className="mb-2 text-xs text-slate-500">
                What time range works best for the collection?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">From</label>
                  <input
                    type="time"
                    value={form.collectionWindowStart}
                    onChange={(e) => setForm((p) => ({ ...p, collectionWindowStart: e.target.value }))}
                    className="input-book"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">To</label>
                  <input
                    type="time"
                    value={form.collectionWindowEnd}
                    onChange={(e) => setForm((p) => ({ ...p, collectionWindowEnd: e.target.value }))}
                    className="input-book"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {form.deliveryType === "COLLECTION_SERVICE" ? "Preferred collection pickup" : "Preferred drop-off date"}
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
              {form.deliveryType === "COLLECTION_SERVICE" ? "Preferred collection return" : "Preferred pickup date"}
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
          disabled={submitting || !form.smsConsent}
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
    <Suspense
      fallback={
        <div className="flex min-h-[320px] items-center justify-center p-6">
          <BikeLoader label="Loading booking…" />
        </div>
      }
    >
      <BookForm />
    </Suspense>
  );
}
