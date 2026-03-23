"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Price } from "@/components/ui/Price";

const STAGE_LABELS: Record<string, string> = {
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STAGE_DESCRIPTIONS: Record<string, string> = {
  BOOKED_IN: "Your repair is scheduled.",
  RECEIVED: "Your bike has arrived at the shop.",
  WORKING_ON: "We're working on your bike.",
  WAITING_ON_PARTS: "We're waiting on parts to complete your repair.",
  BIKE_READY: "Your bike is ready for pickup!",
  COMPLETED: "Thanks for your business!",
  CANCELLED: "This job has been cancelled.",
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function StatusPage() {
  const params = useParams();
  const jobId = params?.jobId as string;
  const [job, setJob] = useState<{
    id: string;
    bikeMake: string;
    bikeModel: string;
    stage: string;
    dropOffDate: string | null;
    pickupDate: string | null;
    paymentStatus: string;
    jobServices: { service: { name: string }; quantity: number; unitPrice: string | number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const stageLabel = STAGE_LABELS[job.stage] ?? job.stage;
  const stageDesc = STAGE_DESCRIPTIONS[job.stage] ?? "";

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">
          {job.bikeMake} {job.bikeModel}
        </h1>
        <p className="mt-1 text-slate-500">Repair status</p>

        <div className="mt-4 flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 border border-amber-200">
          <span className="text-2xl" aria-hidden>🔧</span>
          <div>
            <p className="font-semibold text-amber-900">{stageLabel}</p>
            <p className="text-sm text-amber-800">{stageDesc}</p>
          </div>
        </div>

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

        {job.jobServices && job.jobServices.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Services</h2>
            <ul className="space-y-1 text-sm text-slate-600">
              {job.jobServices.map((js, i) => (
                <li key={i}>
                  {js.service.name} {js.quantity > 1 ? `× ${js.quantity}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm font-semibold text-slate-900">
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
