"use client";

import { useCallback, useState } from "react";
import { OverviewTab } from "@/components/rentals/OverviewTab";
import { FleetTab } from "@/components/rentals/FleetTab";
import { RatesTab } from "@/components/rentals/RatesTab";
import { AddonsTab } from "@/components/rentals/AddonsTab";
import { ReservationsTab, NewReservationModal } from "@/components/rentals/ReservationsTab";
import { SettingsTab } from "@/components/rentals/SettingsTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "reservations", label: "Reservations" },
  { id: "fleet", label: "Fleet" },
  { id: "rates", label: "Rates" },
  { id: "addons", label: "Add-ons" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function RentalsPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [newReservationOpen, setNewReservationOpen] = useState(false);
  const [openReservationsNew, setOpenReservationsNew] = useState(false);
  const [overviewKey, setOverviewKey] = useState(0);

  const navigate = useCallback((next: "reservations" | "fleet" | "rates" | "addons") => {
    setTab(next);
  }, []);

  const handleNewReservation = useCallback(() => {
    if (tab === "reservations") {
      setOpenReservationsNew(true);
    } else {
      setNewReservationOpen(true);
    }
  }, [tab]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-blue-900 dark:text-slate-100">Rentals</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your bike rental fleet, reservations, and availability.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewReservation}
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
        >
          + New Reservation
        </button>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Rentals sections">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {tab === "overview" && (
          <OverviewTab
            onNavigate={navigate}
            onNewReservation={handleNewReservation}
            refreshKey={overviewKey}
          />
        )}
        {tab === "reservations" && (
          <ReservationsTab
            openNew={openReservationsNew}
            onOpenNewConsumed={() => setOpenReservationsNew(false)}
          />
        )}
        {tab === "fleet" && <FleetTab />}
        {tab === "rates" && <RatesTab />}
        {tab === "addons" && <AddonsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>

      <NewReservationModal
        open={newReservationOpen}
        onClose={() => setNewReservationOpen(false)}
        onCreated={() => setOverviewKey((k) => k + 1)}
      />
    </div>
  );
}
