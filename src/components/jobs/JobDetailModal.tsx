"use client";

import { useEffect, useState, useRef } from "react";
import type { Job, JobService, Stage } from "@/lib/types";
import { Price } from "@/components/ui/Price";

const STAGE_LABELS: Record<Stage, string> = {
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STAGE_COLORS: Record<Stage, string> = {
  BOOKED_IN: "bg-slate-500",
  RECEIVED: "bg-slate-600",
  WORKING_ON: "bg-amber-600",
  WAITING_ON_PARTS: "bg-yellow-600",
  BIKE_READY: "bg-emerald-600",
  COMPLETED: "bg-slate-500",
  CANCELLED: "bg-red-500",
};

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface JobDetailModalProps {
  job: Job | null;
  isOpen: boolean;
  onClose: () => void;
  onJobUpdated?: (job: Job) => void;
  onJobDeleted?: (jobId: string) => void;
}

type Tab = "details" | "invoice";

function PaidStatusBlock({ job }: { job: Job }) {
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const customerEmail = job.customer?.email?.trim();

  const handleResendReceipt = async () => {
    setResending(true);
    setResendMessage(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/payments/resend-receipt`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResendMessage("Receipt sent! Check inbox and spam.");
      } else {
        const msg = [data.error ?? data.details, data.hint].filter(Boolean).join(" ");
        setResendMessage(msg || "Failed to send");
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">
        <svg className="h-5 w-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="font-medium">Paid</span>
      </div>
      {customerEmail ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleResendReceipt}
            disabled={resending}
            className="text-sm text-slate-600 hover:text-slate-900 underline disabled:opacity-50"
          >
            {resending ? "Sending…" : "Resend receipt"}
          </button>
          <span className="text-xs text-slate-500">to {customerEmail}</span>
          {resendMessage && (
            <span className={`text-xs ${resendMessage === "Receipt sent!" ? "text-emerald-600" : "text-amber-600"}`}>
              {resendMessage}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-600">
          No customer email on this job. Add a customer with an email to send or resend the receipt.
        </p>
      )}
    </div>
  );
}

function CopyPaymentLinkButton({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/pay/${jobId}` : "";

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 self-start text-sm text-slate-500 hover:text-slate-700"
    >
      {copied ? (
        <>
          <svg className="h-4 w-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          Copy payment link
        </>
      )}
    </button>
  );
}

const CANCELLATION_REASONS = [
  "Customer isn't ready",
  "Customer ghosted us",
  "Customer no longer needs the repair",
  "Customer found another shop",
  "Customer sold the bike",
  "Wrong parts ordered",
  "Bike picked up early / DIY",
  "Other",
] as const;

export function JobDetailModal({ job, isOpen, onClose, onJobUpdated, onJobDeleted }: JobDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonOther, setCancelReasonOther] = useState("");

  const handleCancelJobClick = () => {
    if (!job || job.stage === "CANCELLED") return;
    setShowCancelReason(true);
    setCancelReason("");
    setCancelReasonOther("");
  };

  const getCancellationReasonValue = () => {
    if (cancelReason === "Other") {
      return cancelReasonOther.trim() || "Other";
    }
    return cancelReason;
  };

  const handleCancelReasonConfirm = async () => {
    const value = getCancellationReasonValue();
    if (!job || !value) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "CANCELLED",
          cancellationReason: value,
        }),
      });
      if (res.ok) {
        const updatedJob = await res.json();
        onJobUpdated?.(updatedJob);
        setShowCancelReason(false);
        setCancelReason("");
        setCancelReasonOther("");
      }
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelReasonClose = () => {
    setShowCancelReason(false);
    setCancelReason("");
    setCancelReasonOther("");
  };

  const canConfirmCancellation =
    cancelReason &&
    (cancelReason !== "Other" || cancelReasonOther.trim().length > 0);

  const handleDeleteJob = async () => {
    if (!job) return;
    if (!confirm("Permanently delete this job? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
      if (res.ok) {
        onJobDeleted?.(job.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (job) {
      setActiveTab("details");
      setShowCancelReason(false);
      setCancelReason("");
      setCancelReasonOther("");
    }
  }, [job]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !job) return null;

  const address =
    job.deliveryType === "COLLECTION_SERVICE"
      ? job.collectionAddress || job.customer?.address
      : job.customer?.address;
  const mapsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-soft-lg max-w-lg w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col relative border border-slate-200/80 sm:border-t-0"
        onClick={(e) => e.stopPropagation()}
      >
        {showCancelReason && (
          <div className="absolute inset-0 z-10 flex flex-col bg-white/95 rounded-xl p-6 overflow-hidden">
            <h3 className="text-lg font-semibold text-slate-900 flex-shrink-0 mb-4">
              Why is the job being cancelled?
            </h3>
            <div className="overflow-y-auto flex-1 min-h-0 space-y-2 -mx-1 px-1">
              {CANCELLATION_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50"
                  >
                    <input
                      type="radio"
                      name="cancelReason"
                      value={reason}
                      checked={cancelReason === reason}
                      onChange={() => setCancelReason(reason)}
                      className="w-4 h-4 text-amber-600 border-slate-300 focus:ring-amber-500"
                    />
                    <span className="text-sm font-medium text-slate-900">{reason}</span>
                  </label>
                ))}
            </div>
            {cancelReason === "Other" && (
                <input
                  type="text"
                  value={cancelReasonOther}
                  onChange={(e) => setCancelReasonOther(e.target.value)}
                  placeholder="Please specify"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent flex-shrink-0"
                  autoFocus
                />
            )}
            <div className="flex gap-2 justify-end pt-4 flex-shrink-0 border-t border-slate-200 mt-4 pt-4">
                <button
                  onClick={handleCancelReasonClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCancelReasonConfirm}
                  disabled={cancelling || !canConfirmCancellation}
                  className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cancelling ? "Cancelling…" : "Confirm cancellation"}
                </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate pr-2">
            {job.bikeMake} {job.bikeModel}
          </h2>
          <button
            onClick={onClose}
            className="p-3 -mr-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-slate-200 flex-shrink-0">
          <button
            onClick={() => setActiveTab("details")}
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 text-sm font-medium transition-colors touch-manipulation ${
              activeTab === "details"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab("invoice")}
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 text-sm font-medium transition-colors touch-manipulation ${
              activeTab === "invoice"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Invoice
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 flex-1 space-y-6">
          {activeTab === "invoice" ? (
            <InvoiceTab job={job} onJobUpdated={onJobUpdated} />
          ) : (
            <>
          <div className="flex flex-wrap gap-2">
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                STAGE_COLORS[job.stage as Stage]
              } text-white`}
            >
              {STAGE_LABELS[job.stage as Stage]}
            </span>
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                job.deliveryType === "COLLECTION_SERVICE"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off"}
            </span>
          </div>

          {job.customer && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Customer</h3>
              <p className="font-medium text-slate-900">
                {job.customer.lastName
                  ? `${job.customer.firstName} ${job.customer.lastName}`
                  : job.customer.firstName}
              </p>
              {job.customer.email && (
                <a
                  href={`mailto:${job.customer.email}`}
                  className="text-sm text-emerald-600 hover:text-emerald-800"
                >
                  {job.customer.email}
                </a>
              )}
              {job.customer.phone && (
                <a
                  href={`tel:${job.customer.phone}`}
                  className="block text-sm text-slate-600 hover:text-slate-800"
                >
                  {job.customer.phone}
                </a>
              )}
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</h3>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="text-slate-500 inline">Drop-off:</dt>{" "}
                <dd className="inline text-slate-900">{formatDate(job.dropOffDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 inline">Pickup:</dt>{" "}
                <dd className="inline text-slate-900">{formatDate(job.pickupDate)}</dd>
              </div>
            </dl>
          </div>

          {/* Services – quick reference on Details tab */}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Services</h3>
            {(job.jobServices?.length ?? 0) === 0 ? (
              <p className="text-slate-500 text-sm">No services added</p>
            ) : (
              <div className="space-y-2">
                {(job.jobServices ?? []).map((js) => {
                  const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
                  const lineTotal = price * (js.quantity || 1);
                  return (
                    <div key={js.id} className="flex justify-between items-center py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="font-medium text-slate-900">
                        {js.service?.name ?? "Unknown"}
                        {js.quantity > 1 && (
                          <span className="text-slate-500 font-normal"> × {js.quantity}</span>
                        )}
                      </span>
                      <Price amount={lineTotal} variant="inline" />
                    </div>
                  );
                })}
                <div className="flex justify-between items-center pt-3 mt-2 border-t border-slate-200 font-semibold">
                  <span className="text-slate-900">Total</span>
                  <Price
                    amount={(job.jobServices ?? []).reduce((sum, js) => {
                      const p = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
                      return sum + p * (js.quantity || 1);
                    }, 0)}
                    variant="total"
                  />
                </div>
              </div>
            )}
          </div>

          {address && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Address</h3>
              <p className="text-slate-700">{address}</p>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-sm text-emerald-600 hover:text-emerald-800 font-medium"
                >
                  <span>Get directions</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              )}
            </div>
          )}

          {(job.customerNotes || job.notes || job.internalNotes || (job.stage === "CANCELLED" && job.cancellationReason)) && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes</h3>
              <div className="space-y-3">
                {job.stage === "CANCELLED" && job.cancellationReason && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Cancellation reason</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{job.cancellationReason}</p>
                  </div>
                )}
                {job.customerNotes && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Customer notes</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{job.customerNotes}</p>
                  </div>
                )}
                {job.notes && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Job notes</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{job.notes}</p>
                  </div>
                )}
                {job.internalNotes && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Internal notes</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{job.internalNotes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex gap-2">
            {job.stage !== "CANCELLED" && (
              <button
                onClick={handleCancelJobClick}
                disabled={cancelling}
                className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel Job"}
              </button>
            )}
            <button
              onClick={handleDeleteJob}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-red-800 bg-red-100 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete Job"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceTab({ job, onJobUpdated }: { job: Job; onJobUpdated?: (job: Job) => void }) {
  const [services, setServices] = useState<{ id: string; name: string; price: number | string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const [expandedServiceIds, setExpandedServiceIds] = useState<Set<string>>(new Set());
  const servicesDropdownRef = useRef<HTMLDivElement>(null);

  const toggleServiceExpanded = (id: string) => {
    setExpandedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    fetch("/api/services")
      .then((res) => res.json())
      .then((data) =>
        setServices(
          (Array.isArray(data) ? data : []).map((s: { id: string; name: string; price: unknown }) => ({
            id: s.id,
            name: s.name,
            price: typeof s.price === "string" ? parseFloat(s.price) : Number(s.price ?? 0),
          }))
        )
      );
  }, []);

  const jobServices: JobService[] = job.jobServices ?? [];
  const attachedIds = new Set(jobServices.map((js) => js.serviceId));
  const availableServices = services.filter((s) => !attachedIds.has(s.id));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (servicesDropdownRef.current && !servicesDropdownRef.current.contains(e.target as Node)) {
        setServicesDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddService = async (serviceId: string) => {
    setAdding(true);
    setServicesDropdownOpen(false);
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveService = async (jobServiceId: string) => {
    setRemoving(jobServiceId);
    try {
      const res = await fetch(
        `/api/jobs/${job.id}/services?jobServiceId=${encodeURIComponent(jobServiceId)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setRemoving(null);
    }
  };

  const total = jobServices.reduce((sum, js) => {
    const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    return sum + price * (js.quantity || 1);
  }, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex-shrink-0">
          Services
        </h3>
        {availableServices.length > 0 && (
          <div ref={servicesDropdownRef} className="relative flex-shrink min-w-0 w-full max-w-[260px]">
            <button
              type="button"
              onClick={() => setServicesDropdownOpen((o) => !o)}
              disabled={adding}
              className="w-full text-left text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 truncate disabled:opacity-50"
            >
              {adding ? "Adding…" : "+ Add service"}
            </button>
            {servicesDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                {availableServices.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleAddService(s.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg flex flex-col items-start min-w-0"
                  >
                    <span className="font-medium truncate w-full">{s.name}</span>
                    <span className="text-slate-500 text-xs">
                      ${Number(s.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {jobServices.length === 0 ? (
        <p className="text-slate-500">
          {availableServices.length > 0
            ? "No services added yet. Use the dropdown above to add."
            : "No services added yet. Add services in Settings → Services first."}
        </p>
      ) : (
        <div className="space-y-2">
          {jobServices.map((js) => {
            const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
            const lineTotal = price * (js.quantity || 1);
            const isExpanded = expandedServiceIds.has(js.id);
            return (
              <div
                key={js.id}
                className="border border-slate-200 rounded-lg overflow-hidden"
              >
                <div
                  className="flex justify-between items-center py-2 px-3 group cursor-pointer hover:bg-slate-50"
                  onClick={() => toggleServiceExpanded(js.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span
                      className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                      aria-hidden
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                    <p className="font-medium text-slate-900">
                      {js.service?.name ?? "Unknown service"}
                      {js.quantity > 1 && (
                        <span className="text-slate-500 font-normal"> × {js.quantity}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Price amount={lineTotal} variant="inline" />
                    <button
                      onClick={() => handleRemoveService(js.id)}
                      disabled={removing === js.id}
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove service"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="px-3 pb-3 pt-0 border-t border-slate-100 bg-slate-50/50">
                      {js.service?.description && (
                        <p className="text-xs text-slate-600 mt-2 whitespace-pre-line">{js.service.description}</p>
                      )}
                      <dl className="mt-2 text-xs text-slate-500 space-y-1">
                        <div className="flex justify-between gap-4">
                          <dt>Unit price</dt>
                          <dd><Price amount={price} variant="inline" /></dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Quantity</dt>
                          <dd>{js.quantity}</dd>
                        </div>
                        {js.notes && (
                          <div>
                            <dt className="text-slate-500">Notes</dt>
                            <dd className="text-slate-600 mt-0.5">{js.notes}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-slate-200">
            <span className="font-bold text-slate-900">Total</span>
            <Price amount={total} variant="total" />
          </div>
          {job.paymentStatus === "PAID" ? (
            <PaidStatusBlock job={job} />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/pay/${job.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Pay online
                </a>
                <a
                  href={`/pay/${job.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Collect in person
                </a>
              </div>
              <CopyPaymentLinkButton jobId={job.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
