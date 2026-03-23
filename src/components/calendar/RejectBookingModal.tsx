"use client";

import { useState } from "react";
import type { Job } from "@/lib/types";

interface RejectBookingModalProps {
  job: Job | null;
  isOpen: boolean;
  onClose: () => void;
  onReject: (jobId: string, reason: string) => Promise<void>;
}

export function RejectBookingModal({
  job,
  isOpen,
  onClose,
  onReject,
}: RejectBookingModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !job) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onReject(job.id, trimmed);
      setReason("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reject-modal-title" className="text-lg font-bold text-slate-900">
          Reject booking
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {job.bikeMake} {job.bikeModel} – {job.customer?.firstName}{" "}
          {job.customer?.lastName ?? ""}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="reject-reason"
              className="block text-sm font-medium text-slate-700"
            >
              Reason for rejection <span className="text-red-500">*</span>
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              The customer will see this on their status page and receive it by
              email.
            </p>
            <textarea
              id="reject-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. We don't service e-bikes / We're at capacity this week / ..."
              className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-2 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-y"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? "Rejecting…" : "Reject booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
