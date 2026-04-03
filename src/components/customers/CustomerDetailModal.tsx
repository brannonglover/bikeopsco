"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCustomerName } from "@/lib/customer";
import {
  formatPhoneDisplay,
  formatPhoneInputUS,
  phoneTelHref,
  phoneToInputValue,
} from "@/lib/phone";
import { BikePlaceholderIcon } from "@/components/ui/BikePlaceholderIcon";
import type L from "leaflet";

interface Bike {
  id: string;
  make: string;
  model: string;
  bikeType: "REGULAR" | "E_BIKE" | null;
  nickname: string | null;
  imageUrl: string | null;
  customerId: string;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

interface CustomerDetailModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  /** Editable fields + bikes in one modal (no separate field-only step). */
  inlineCustomerEdit?: boolean;
  /** After saving customer fields in inline mode. */
  onCustomerSaved?: (customer: Customer) => void;
  /** View mode: enter inline edit without closing the modal. */
  onBeginEditCustomer?: () => void;
}

function BikeImageSearch({
  make,
  model,
  onSelect,
  disabled,
  onBusyChange,
}: {
  make: string;
  model: string;
  onSelect: (url: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; thumbUrl: string; fullUrl: string; source?: string }>
  >([]);
  const [provider, setProvider] = useState<"serper" | "unsplash" | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasQuery = make.trim() || model.trim();

  useEffect(() => {
    if (!showResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showResults]);

  const handleSearch = async () => {
    if (!hasQuery) return;
    setSearching(true);
    setError(null);
    setResults([]);
    setProvider(null);
    setShowResults(true);
    try {
      const res = await fetch(
        `/api/bikes/search-image?make=${encodeURIComponent(make.trim())}&model=${encodeURIComponent(model.trim())}`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data.results)) {
        setResults(data.results);
        setProvider(data.provider ?? null);
        if (data.results.length === 0) setError("No images found. Try different make/model or add a photo manually.");
      } else {
        setError(data.error || "Search failed. Add a photo manually.");
      }
    } catch {
      setError("Search failed. Add a photo manually.");
    } finally {
      setSearching(false);
    }
  };

  const handlePick = async (fullUrl: string) => {
    setImporting(true);
    onBusyChange?.(true);
    try {
      const res = await fetch("/api/bikes/import-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        onSelect(data.url);
        setShowResults(false);
      } else {
        alert(data.error || "Could not save image");
      }
    } catch {
      alert("Could not save image");
    } finally {
      setImporting(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleSearch}
        disabled={disabled || !hasQuery || searching}
        className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {searching ? "Searching..." : "Search for image online"}
      </button>
      {showResults && (
        <div className="absolute left-0 top-full mt-2 z-20 w-72 p-3 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-slate-600">Search results</span>
            <button
              type="button"
              onClick={() => setShowResults(false)}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {searching ? (
            <p className="text-sm text-slate-500 py-4">Searching Unsplash...</p>
          ) : error ? (
            <p className="text-sm text-slate-600 py-2">{error}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handlePick(r.fullUrl)}
                  disabled={importing}
                  className="aspect-square rounded overflow-hidden border-2 border-transparent hover:border-indigo-500 focus:border-indigo-500 transition-colors"
                >
                  <img
                    src={r.thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && provider && (
            <p className="text-[10px] text-slate-400 mt-2">
              {provider === "serper" ? (
                "Images from web search"
              ) : (
                <>
                  Photos from{" "}
                  <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="underline">
                    Unsplash
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddBikeForm({
  customerId,
  onAdded,
  onCancel,
}: {
  customerId: string;
  onAdded: (bike: Bike) => void;
  onCancel: () => void;
}) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [nickname, setNickname] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bikeType, setBikeType] = useState<"AUTO" | "REGULAR" | "E_BIKE">("AUTO");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const imageBusy = uploading || importing;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/bikes/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) setImageUrl(data.url);
      else alert(data.error || "Upload failed");
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!make.trim() || !model.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/bikes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make: make.trim(),
          model: model.trim(),
          bikeType: bikeType === "AUTO" ? null : bikeType,
          nickname: nickname.trim() || null,
          imageUrl: imageUrl.trim() || null,
        }),
      });
      if (res.ok) {
        const bike = await res.json();
        onAdded(bike);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add bike");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 p-3 bg-slate-50 rounded-lg">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {imageUrl ? (
            <div className="relative">
              <img
                src={imageUrl}
                alt="Bike"
                className="w-20 h-20 object-cover rounded-lg border border-slate-200"
              />
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <label className="flex items-center justify-center w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  disabled={imageBusy}
                  onChange={handleImageUpload}
                />
                <span className="text-xs text-slate-500 text-center px-1">
                  {imageBusy ? "..." : "Add photo"}
                </span>
              </label>
              <BikeImageSearch
                make={make}
                model={model}
                onSelect={setImageUrl}
                disabled={imageBusy}
                onBusyChange={setImporting}
              />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Make (e.g. Trek)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            required
          />
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model (e.g. Domane SL 6)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            required
          />
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname (optional)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <label className="block text-xs font-medium text-slate-500 mt-2 mb-1">Bike type</label>
          <select
            value={bikeType}
            onChange={(e) =>
              setBikeType(e.target.value as "AUTO" | "REGULAR" | "E_BIKE")
            }
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="AUTO">Auto (from make/model)</option>
            <option value="REGULAR">Standard bike</option>
            <option value="E_BIKE">E-bike</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || imageBusy || !make.trim() || !model.trim()}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Adding..." : imageBusy ? "Uploading image..." : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-slate-600 text-sm hover:text-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditBikeForm({
  bike,
  onSaved,
  onCancel,
}: {
  bike: Bike;
  onSaved: (bike: Bike) => void;
  onCancel: () => void;
}) {
  const [make, setMake] = useState(bike.make);
  const [model, setModel] = useState(bike.model);
  const [nickname, setNickname] = useState(bike.nickname ?? "");
  const [imageUrl, setImageUrl] = useState(bike.imageUrl ?? "");
  const [bikeType, setBikeType] = useState<"AUTO" | "REGULAR" | "E_BIKE">(
    bike.bikeType ?? "AUTO"
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const imageBusy = uploading || importing;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/bikes/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) setImageUrl(data.url);
      else alert(data.error || "Upload failed");
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!make.trim() || !model.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/customers/${bike.customerId}/bikes/${bike.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            make: make.trim(),
            model: model.trim(),
            bikeType: bikeType === "AUTO" ? null : bikeType,
            nickname: nickname.trim() || null,
            imageUrl: imageUrl.trim() || null,
          }),
        }
      );
      if (res.ok) {
        const updated = await res.json();
        onSaved(updated);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update bike");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 p-3 bg-slate-50 rounded-lg">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {imageUrl ? (
            <div className="relative">
              <img
                src={imageUrl}
                alt="Bike"
                className="w-20 h-20 object-cover rounded-lg border border-slate-200"
              />
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <label className="flex items-center justify-center w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  disabled={imageBusy}
                  onChange={handleImageUpload}
                />
                <span className="text-xs text-slate-500 text-center px-1">
                  {imageBusy ? "..." : "Add photo"}
                </span>
              </label>
              <BikeImageSearch
                make={make}
                model={model}
                onSelect={setImageUrl}
                disabled={imageBusy}
                onBusyChange={setImporting}
              />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Make"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            required
          />
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            required
          />
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname (optional)"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <label className="block text-xs font-medium text-slate-500">Bike type</label>
          <select
            value={bikeType}
            onChange={(e) =>
              setBikeType(e.target.value as "AUTO" | "REGULAR" | "E_BIKE")
            }
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="AUTO">Auto (from make/model)</option>
            <option value="REGULAR">Standard bike</option>
            <option value="E_BIKE">E-bike</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || imageBusy || !make.trim() || !model.trim()}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : imageBusy ? "Uploading image..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-slate-600 text-sm hover:text-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function CustomerMap({ address }: { address: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const appleMapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(address)}`;

  useEffect(() => {
    if (!address || !mapRef.current) return;

    let mounted = true;

    async function initMap() {
      try {
        const L = (await import("leaflet")).default;

        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
          {
            headers: {
              Accept: "application/json",
              "User-Agent": "Bike Ops/1.0 (bike repair shop management)",
            },
          }
        );
        const data = await res.json();

        if (!mounted || !mapRef.current) return;

        if (!data || data.length === 0) {
          setError("Could not find location");
          setLoading(false);
          return;
        }

        const { lat, lon } = data[0];
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);

        const mapInstance = L.map(mapRef.current).setView([latNum, lonNum], 15);
        mapInstanceRef.current = mapInstance;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
        }).addTo(mapInstance);

        // Fix Leaflet default icon in Next.js
        const DefaultIcon = L.icon({
          iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          iconRetinaUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          shadowUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
        });
        L.marker([latNum, lonNum], { icon: DefaultIcon }).addTo(mapInstance);
      } catch {
        if (mounted) setError("Could not load map");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initMap();
    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [address]);

  return (
    <div className="mt-3">
      <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100 aspect-video relative min-h-[200px]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
            Loading map...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
            {error}
          </div>
        )}
        <div ref={mapRef} className="w-full h-full min-h-[200px]" />
      </div>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <span>Open in Maps</span>
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
      <p className="mt-1 text-xs text-slate-500">
        Opens Google Maps on your phone or desktop. Use Apple Maps?{" "}
        <a
          href={appleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Open in Apple Maps
        </a>
      </p>
    </div>
  );
}

export function CustomerDetailModal({
  customer,
  isOpen,
  onClose,
  inlineCustomerEdit = false,
  onCustomerSaved,
  onBeginEditCustomer,
}: CustomerDetailModalProps) {
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikesLoading, setBikesLoading] = useState(false);
  const [showAddBike, setShowAddBike] = useState(false);
  const [editingBike, setEditingBike] = useState<Bike | null>(null);

  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const fetchBikes = useCallback(async (customerId: string) => {
    setBikesLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/bikes`);
      const data = await res.json();
      setBikes(Array.isArray(data) ? data : []);
    } catch {
      setBikes([]);
    } finally {
      setBikesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (customer?.id) {
      fetchBikes(customer.id);
      setShowAddBike(false);
      setEditingBike(null);
    } else {
      setBikes([]);
    }
  }, [customer?.id, fetchBikes]);

  useEffect(() => {
    if (!customer || !inlineCustomerEdit) return;
    setEditFirstName(customer.firstName);
    setEditLastName(customer.lastName ?? "");
    setEditEmail(customer.email ?? "");
    setEditPhone(phoneToInputValue(customer.phone));
    setEditAddress(customer.address ?? "");
    setEditNotes(customer.notes ?? "");
  }, [customer, inlineCustomerEdit]);

  const handleSaveCustomerFields = async () => {
    if (!customer || !editFirstName.trim()) return;
    setSavingCustomer(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: editFirstName.trim(),
          lastName: editLastName.trim() || null,
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
          address: editAddress.trim() || null,
          notes: editNotes.trim() || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEditPhone(phoneToInputValue(updated.phone));
        onCustomerSaved?.(updated);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to save");
      }
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-t-lg sm:rounded-lg shadow-xl max-w-lg w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {customer ? (
          <>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex justify-between items-start">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate pr-2">
                {inlineCustomerEdit
                  ? "Edit customer"
                  : formatCustomerName(customer)}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-2 -mr-2 text-slate-400 hover:text-slate-600 text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              {inlineCustomerEdit ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Customer
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        First name *
                      </label>
                      <input
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Last name
                      </label>
                      <input
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="tel"
                        autoComplete="tel"
                        value={editPhone}
                        onChange={(e) =>
                          setEditPhone(formatPhoneInputUS(e.target.value))
                        }
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Address
                      </label>
                      <input
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    {editAddress.trim() && (
                      <div className="sm:col-span-2">
                        <CustomerMap address={editAddress.trim()} />
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Notes
                      </label>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={2}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {(customer.email || customer.phone) && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Contact
                      </h3>
                      <div className="space-y-1">
                        {customer.email && (
                          <p>
                            <a
                              href={`mailto:${customer.email}`}
                              className="text-blue-600 hover:underline"
                            >
                              {customer.email}
                            </a>
                          </p>
                        )}
                        {customer.phone && (
                          <p>
                            <a
                              href={phoneTelHref(customer.phone)}
                              className="phone-link-touch text-blue-600 hover:underline"
                            >
                              {formatPhoneDisplay(customer.phone)}
                            </a>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {customer.address && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Address
                      </h3>
                      <p className="text-slate-700">{customer.address}</p>
                      <CustomerMap address={customer.address} />
                    </div>
                  )}
                </>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                    Bikes
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddBike(true);
                      setEditingBike(null);
                    }}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    + Add bike
                  </button>
                </div>
                {bikesLoading ? (
                  <p className="text-slate-500 text-sm py-2">Loading bikes...</p>
                ) : showAddBike ? (
                  <AddBikeForm
                    customerId={customer.id}
                    onAdded={(bike) => {
                      setBikes((prev) => [...prev, bike]);
                      setShowAddBike(false);
                    }}
                    onCancel={() => setShowAddBike(false)}
                  />
                ) : editingBike ? (
                  <EditBikeForm
                    bike={editingBike}
                    onSaved={(bike) => {
                      setBikes((prev) =>
                        prev.map((b) => (b.id === bike.id ? bike : b))
                      );
                      setEditingBike(null);
                    }}
                    onCancel={() => setEditingBike(null)}
                  />
                ) : bikes.length === 0 ? (
                  <p className="text-slate-500 text-sm py-2">
                    No bikes added yet. Click &quot;Add bike&quot; to add one.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {bikes.map((bike) => (
                      <li
                        key={bike.id}
                        className="flex items-center gap-3 py-2 px-3 bg-slate-50 rounded-lg"
                      >
                        {bike.imageUrl ? (
                          <img
                            src={bike.imageUrl}
                            alt={`${bike.make} ${bike.model}`}
                            className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-200 flex-shrink-0 flex items-center justify-center">
                            <BikePlaceholderIcon className="w-6 h-6 text-slate-400" />
                          </div>
                        )}
                        <span className="font-medium text-slate-900 flex-1 min-w-0">
                          {bike.nickname
                            ? `${bike.nickname}`
                            : `${bike.make} ${bike.model}`}
                          {bike.nickname && (
                            <span className="text-slate-500 font-normal ml-1">
                              ({bike.make} {bike.model})
                            </span>
                          )}
                        </span>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBike(bike);
                              setShowAddBike(false);
                            }}
                            className="text-slate-500 hover:text-indigo-600 text-sm px-2 py-1"
                            aria-label="Edit bike"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm("Remove this bike from the profile?"))
                                return;
                              const res = await fetch(
                                `/api/customers/${customer.id}/bikes/${bike.id}`,
                                { method: "DELETE" }
                              );
                              if (res.ok) {
                                setBikes((prev) =>
                                  prev.filter((b) => b.id !== bike.id)
                                );
                              }
                            }}
                            className="text-slate-500 hover:text-red-600 text-sm px-2 py-1"
                            aria-label="Delete bike"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!inlineCustomerEdit && customer.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Notes
                  </h3>
                  <p className="text-slate-700 whitespace-pre-line">
                    {customer.notes}
                  </p>
                </div>
              )}

              {!inlineCustomerEdit &&
                !customer.email &&
                !customer.phone &&
                !customer.address &&
                !customer.notes &&
                bikes.length === 0 &&
                !showAddBike &&
                !editingBike && (
                  <p className="text-slate-500 py-4">
                    No additional details for this customer.
                  </p>
                )}
            </div>

            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap gap-2">
              {inlineCustomerEdit ? (
                <>
                  <button
                    type="button"
                    disabled={
                      savingCustomer || !editFirstName.trim()
                    }
                    onClick={handleSaveCustomerFields}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingCustomer ? "Saving…" : "Save customer"}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium"
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  {onBeginEditCustomer && (
                    <button
                      type="button"
                      onClick={onBeginEditCustomer}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="p-6">
            <p className="text-slate-500">No customer selected.</p>
          </div>
        )}
      </div>
    </div>
  );
}
