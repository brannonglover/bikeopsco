"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Price } from "@/components/ui/Price";
import { BikePlaceholderIcon } from "@/components/ui/BikePlaceholderIcon";

const STAGE_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting confirmation",
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STAGE_DESCRIPTIONS: Record<string, string> = {
  PENDING_APPROVAL: "We're reviewing your booking and will confirm shortly.",
  BOOKED_IN: "Your repair is scheduled.",
  RECEIVED: "Your bike has arrived at the shop.",
  WORKING_ON: "We're working on your bike.",
  WAITING_ON_PARTS: "We're waiting on parts to complete your repair.",
  BIKE_READY: "Your bike is ready for pickup!",
  COMPLETED: "Thanks for your business!",
  CANCELLED: "This job has been cancelled.",
};

const BIKE_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting confirmation",
  BOOKED_IN: "Booked in",
  RECEIVED: "Received",
  WORKING_ON: "In queue",
  WAITING_ON_PARTS: "Waiting on parts",
  BIKE_READY: "Ready for pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type StatusJobBike = {
  id: string;
  make: string;
  model: string;
  nickname: string | null;
  imageUrl: string | null;
  bikeId: string | null;
  completedAt?: string | null;
  waitingOnPartsAt?: string | null;
  bike?: { imageUrl: string | null; nickname?: string | null; make: string; model: string } | null;
};

type StatusJobService = {
  id: string;
  service?: { name: string; description?: string | null } | null;
  customServiceName?: string | null;
  quantity: number;
  unitPrice: string | number;
  jobBike?: { id: string } | null;
};

type StatusJob = {
  id: string;
  bikeMake: string;
  bikeModel: string;
  stage: string;
  workingOnJobBikeId?: string | null;
  jobBikes?: StatusJobBike[];
  customer?: { bikes?: { make: string; model: string; imageUrl: string | null }[] } | null;
  dropOffDate: string | null;
  pickupDate: string | null;
  paymentStatus: string;
  cancellationReason?: string | null;
  jobServices: StatusJobService[];
};

function resolveBikeDisplay(b: StatusJobBike): { name: string; imageUrl: string | null } {
  const linked = b.bikeId && b.bike ? b.bike : null;
  const make = linked?.make ?? b.make;
  const model = linked?.model ?? b.model;
  const nickname = b.nickname?.trim() || linked?.nickname?.trim() || null;
  const imageUrl = b.imageUrl ?? linked?.imageUrl ?? null;
  return {
    name: nickname || [make, model].filter(Boolean).join(" "),
    imageUrl,
  };
}

function BikeStatusBadge({ stage, isWorkingOn, isCompleted, isWaitingOnParts }: { stage: string; isWorkingOn: boolean; isCompleted: boolean; isWaitingOnParts: boolean }) {
  if (isCompleted) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Done
      </span>
    );
  }

  if (isWaitingOnParts) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
        Waiting on parts
      </span>
    );
  }

  if (isWorkingOn) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-1 rounded-full">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        Being worked on now
      </span>
    );
  }

  const label = BIKE_STATUS_LABEL[stage] ?? stage;

  const colorMap: Record<string, string> = {
    PENDING_APPROVAL: "text-slate-600 bg-slate-100 border-slate-200",
    BOOKED_IN: "text-slate-600 bg-slate-100 border-slate-200",
    RECEIVED: "text-blue-700 bg-blue-50 border-blue-200",
    WORKING_ON: "text-slate-600 bg-slate-100 border-slate-200",
    WAITING_ON_PARTS: "text-yellow-800 bg-yellow-50 border-yellow-200",
    BIKE_READY: "text-emerald-700 bg-emerald-50 border-emerald-200",
    COMPLETED: "text-emerald-700 bg-emerald-50 border-emerald-200",
    CANCELLED: "text-red-700 bg-red-50 border-red-200",
  };

  return (
    <span className={`inline-flex text-xs font-semibold px-2 py-1 rounded-full border ${colorMap[stage] ?? "text-slate-600 bg-slate-100 border-slate-200"}`}>
      {label}
    </span>
  );
}

export default function StatusPage() {
  const params = useParams();
  const jobId = params?.jobId as string;
  const [job, setJob] = useState<StatusJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBikes, setExpandedBikes] = useState<Set<string>>(new Set());
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  function toggleBike(id: string) {
    setExpandedBikes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleService(id: string) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!jobId) return;

    fetch(`/api/jobs/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Job not found");
        return res.json();
      })
      .then(setJob)
      .catch(() => setError("Job not found"))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
        <p className="text-slate-500">Loading status…</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <p className="text-red-600 font-medium">{error ?? "Job not found"}</p>
      </div>
    );
  }

  const total = (job.jobServices ?? []).reduce(
    (sum: number, js: { unitPrice: string | number; quantity: number }) => {
      const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      return sum + price * (js.quantity || 1);
    },
    0
  );

  const servicesByBikeId = (job.jobServices ?? []).reduce<Map<string | null, StatusJobService[]>>(
    (map, js) => {
      const key = js.jobBike?.id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(js);
      return map;
    },
    new Map()
  );

  const unassignedServices = servicesByBikeId.get(null) ?? [];
  const hasAssignedServices = [...servicesByBikeId.keys()].some((k) => k !== null);

  const stageLabel = STAGE_LABELS[job.stage] ?? job.stage;
  const stageDesc = STAGE_DESCRIPTIONS[job.stage] ?? "";

  const bikes: StatusJobBike[] = (job.jobBikes ?? []).length > 0
    ? [...(job.jobBikes ?? [])].sort((a: StatusJobBike & { sortOrder?: number }, b: StatusJobBike & { sortOrder?: number }) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    : [];
  const hasBikes = bikes.length > 0;
  const hasMultipleBikes = bikes.length > 1;

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">
          {job.bikeMake} {job.bikeModel}
        </h1>
        <p className="mt-1 text-slate-500">Repair status</p>

        <div
          className={`mt-4 flex items-center gap-3 rounded-lg px-4 py-3 border ${
            job.stage === "CANCELLED"
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <span className="text-2xl" aria-hidden>
            {job.stage === "CANCELLED" ? "✕" : "🔧"}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`font-semibold ${
                job.stage === "CANCELLED" ? "text-red-900" : "text-amber-900"
              }`}
            >
              {stageLabel}
            </p>
            <p
              className={`text-sm ${
                job.stage === "CANCELLED" ? "text-red-800" : "text-amber-800"
              }`}
            >
              {stageDesc}
            </p>
            {job.stage === "CANCELLED" &&
              job.cancellationReason &&
              job.cancellationReason.trim() && (
                <p className="mt-2 text-sm text-red-700">
                  {job.cancellationReason}
                </p>
              )}
          </div>
        </div>

        {hasBikes && (
          <div className="mt-5 pt-4 border-t border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              {hasMultipleBikes ? `Your bikes (${bikes.length})` : "Your bike"}
            </h2>
            <div className="space-y-3">
              {bikes.map((b) => {
                const { name, imageUrl } = resolveBikeDisplay(b);
                const isWorkingOn = !!job.workingOnJobBikeId && job.workingOnJobBikeId === b.id;
                const isCompleted = !!b.completedAt;
                const isWaitingOnParts = !!b.waitingOnPartsAt && !isCompleted;
                const bikeServices = servicesByBikeId.get(b.id) ?? [];
                const isExpanded = expandedBikes.has(b.id);
                return (
                  <div
                    key={b.id}
                    className={`rounded-xl border transition-colors ${
                      isCompleted
                        ? "border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/40 dark:bg-emerald-500/10"
                        : isWaitingOnParts
                          ? "border-red-200 dark:border-red-500/25 bg-red-50/40 dark:bg-red-500/10"
                          : isWorkingOn
                            ? "border-amber-300 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10"
                            : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div
                      className={`flex items-center gap-3 p-3 ${bikeServices.length > 0 ? "cursor-pointer select-none" : ""}`}
                      onClick={() => bikeServices.length > 0 && toggleBike(b.id)}
                      role={bikeServices.length > 0 ? "button" : undefined}
                      aria-expanded={bikeServices.length > 0 ? isExpanded : undefined}
                    >
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt={name}
                          width={56}
                          height={56}
                          className="w-14 h-14 flex-shrink-0 object-cover rounded-lg border border-slate-200"
                        />
                      ) : (
                        <div className="w-14 h-14 flex-shrink-0 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                          <BikePlaceholderIcon className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium truncate ${isCompleted || isWaitingOnParts ? "text-slate-500" : "text-slate-900"}`}>{name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <BikeStatusBadge stage={job.stage} isWorkingOn={isWorkingOn} isCompleted={isCompleted} isWaitingOnParts={isWaitingOnParts} />
                          {bikeServices.length > 0 && !isExpanded && (
                            <span className="text-xs text-slate-400">
                              {bikeServices.length} {bikeServices.length === 1 ? "service" : "services"}
                            </span>
                          )}
                        </div>
                      </div>
                      {bikeServices.length > 0 && (
                        <svg
                          className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </div>
                    {bikeServices.length > 0 && (
                      <div
                        className={`overflow-hidden transition-all duration-200 ${isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}
                      >
                        <div className="px-3 pb-3 border-t border-slate-200/70 dark:border-slate-700/50 pt-2.5">
                          <ul className="space-y-0.5">
                            {bikeServices.map((js) => {
                              const desc = js.service?.description?.trim() || null;
                              const isServiceOpen = expandedServices.has(js.id);
                              return (
                                <li key={js.id}>
                                  <div
                                    className={`flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 ${desc ? "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" : ""}`}
                                    onClick={() => desc && toggleService(js.id)}
                                    role={desc ? "button" : undefined}
                                    aria-expanded={desc ? isServiceOpen : undefined}
                                  >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      {desc && (
                                        <svg
                                          className={`w-3.5 h-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${isServiceOpen ? "rotate-180" : ""}`}
                                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      )}
                                      <span className="text-slate-600 truncate">
                                        {js.service?.name ?? js.customServiceName ?? "Service"}
                                        {js.quantity > 1 && <span className="text-slate-400"> × {js.quantity}</span>}
                                      </span>
                                    </span>
                                    <Price
                                      amount={(typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice)) * (js.quantity || 1)}
                                      variant="total"
                                    />
                                  </div>
                                  {desc && (
                                    <div className={`overflow-hidden transition-all duration-200 ${isServiceOpen ? "max-h-48 opacity-100" : "max-h-0 opacity-0"}`}>
                                      <p className="text-xs text-slate-500 px-2 pb-1.5 leading-relaxed">{desc}</p>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(job.dropOffDate || job.pickupDate) && (
          <dl className="mt-4 space-y-1 text-sm">
            {job.dropOffDate && (
              <>
                <dt className="text-slate-500">Drop-off</dt>
                <dd className="text-slate-900">{formatDate(job.dropOffDate)}</dd>
              </>
            )}
            {job.pickupDate && (
              <>
                <dt className="text-slate-500 mt-2">Pickup (expected)</dt>
                <dd className="text-slate-900">{formatDate(job.pickupDate)}</dd>
              </>
            )}
          </dl>
        )}

        {((!hasBikes && job.jobServices && job.jobServices.length > 0) ||
          (hasBikes && (unassignedServices.length > 0 || !hasAssignedServices) && job.jobServices && job.jobServices.length > 0)) && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              {hasBikes && unassignedServices.length > 0 ? "Other services" : "Services"}
            </h2>
            <ul className="space-y-0.5">
              {(hasBikes ? unassignedServices : job.jobServices).map((js) => {
                const desc = js.service?.description?.trim() || null;
                const isServiceOpen = expandedServices.has(js.id);
                return (
                  <li key={js.id}>
                    <div
                      className={`flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 ${desc ? "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" : ""}`}
                      onClick={() => desc && toggleService(js.id)}
                      role={desc ? "button" : undefined}
                      aria-expanded={desc ? isServiceOpen : undefined}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {desc && (
                          <svg
                            className={`w-3.5 h-3.5 flex-shrink-0 text-slate-400 transition-transform duration-150 ${isServiceOpen ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                        <span className="text-slate-600 truncate">
                          {js.service?.name ?? js.customServiceName ?? "Service"}
                          {js.quantity > 1 && <span className="text-slate-400"> × {js.quantity}</span>}
                        </span>
                      </span>
                      <Price
                        amount={(typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice)) * (js.quantity || 1)}
                        variant="total"
                      />
                    </div>
                    {desc && (
                      <div className={`overflow-hidden transition-all duration-200 ${isServiceOpen ? "max-h-48 opacity-100" : "max-h-0 opacity-0"}`}>
                        <p className="text-xs text-slate-500 px-2 pb-1.5 leading-relaxed">{desc}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {job.jobServices && job.jobServices.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Total</span>
            <p className="text-sm font-semibold text-slate-900">
              <Price amount={total} variant="total" />
            </p>
          </div>
        )}
      </div>

      {job.paymentStatus !== "PAID" && total > 0 && (
        <Link
          href={`/pay/${job.id}`}
          className="block w-full rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white hover:bg-emerald-700"
        >
          Pay online
        </Link>
      )}

      <p className="text-center text-xs text-slate-500">
        Questions? Contact the shop directly.
      </p>
    </div>
  );
}
