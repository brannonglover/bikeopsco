"use client";

import { useEffect, useRef, useState } from "react";
import { formatCustomerName } from "@/lib/customer";
import type L from "leaflet";

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
  onEdit?: (customer: Customer) => void;
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
              "User-Agent": "BikeOps/1.0 (bike repair shop management)",
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
  onEdit,
}: CustomerDetailModalProps) {
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
                {formatCustomerName(customer)}
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
                          href={`tel:${customer.phone}`}
                          className="text-blue-600 hover:underline"
                        >
                          {customer.phone}
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

              {customer.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Notes
                  </h3>
                  <p className="text-slate-700 whitespace-pre-line">
                    {customer.notes}
                  </p>
                </div>
              )}

              {!customer.email &&
                !customer.phone &&
                !customer.address &&
                !customer.notes && (
                  <p className="text-slate-500 py-4">
                    No additional details for this customer.
                  </p>
                )}
            </div>

            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(customer);
                  }}
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
