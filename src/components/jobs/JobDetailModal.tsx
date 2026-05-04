"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState, useRef } from "react";
import type { Job, JobBike, JobProduct, JobService, Stage } from "@/lib/types";
import { Price } from "@/components/ui/Price";
import { BikePlaceholderIcon } from "@/components/ui/BikePlaceholderIcon";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";
import { resolveEffectiveBikeType } from "@/lib/bike-type";
import {
  formatBikeTypeDisplayLineForJob,
  getDisplayPartsForJobBikeRow,
  getJobBikeDisplayTitle,
} from "@/lib/job-display";
import { getJobPaymentSummary } from "@/lib/job-payments";
import { formatPhoneDisplay, phoneTelHref } from "@/lib/phone";

function formatChatPreviewTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type CustomerChatPreviewPayload = {
  id: string;
  lastMessage: {
    body: string | null;
    sender: "STAFF" | "CUSTOMER" | "SYSTEM";
    createdAt: string;
    attachmentCount: number;
  } | null;
};

function CustomerChatSection({ customerId }: { customerId: string }) {
  const features = useAppFeatures();
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [conversation, setConversation] = useState<CustomerChatPreviewPayload | null>(null);

  useEffect(() => {
    if (!features.chatEnabled) {
      setStatus("ready");
      setConversation(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetch(
      `/api/conversations/by-customer/${encodeURIComponent(customerId)}?markRead=1`
    )
      .then((r) => r.json())
      .then((data: { conversation?: CustomerChatPreviewPayload | null }) => {
        if (cancelled) return;
        setConversation(data.conversation ?? null);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, features.chatEnabled]);

  if (!features.chatEnabled) return null;

  const chatHref = `/chat?customer=${encodeURIComponent(customerId)}`;

  const lastMessageLine = (msg: NonNullable<CustomerChatPreviewPayload["lastMessage"]>) => {
    const text = msg.body?.trim();
    const hasAtt = msg.attachmentCount > 0;
    const prefix = msg.sender === "STAFF" ? "You: " : msg.sender === "SYSTEM" ? "Auto: " : "";
    if (text) {
      const t = text.length > 140 ? `${text.slice(0, 140)}…` : text;
      return prefix + t;
    }
    if (hasAtt) return `${prefix}📎 Image`;
    return `${prefix}—`;
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Chat</h3>
      {status === "loading" && <p className="text-sm text-slate-400">Loading…</p>}
      {status === "error" && (
        <Link
          href={chatHref}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline touch-manipulation"
        >
          Open chat
        </Link>
      )}
      {status === "ready" && (
        <div className="space-y-2">
          {conversation?.lastMessage ? (
            <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">
              {lastMessageLine(conversation.lastMessage)}
              <span className="text-slate-400 text-xs ml-1.5">
                · {formatChatPreviewTime(conversation.lastMessage.createdAt)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-500">No messages yet.</p>
          )}
          <Link
            href={chatHref}
            className="inline-flex text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline touch-manipulation"
          >
            Open chat
          </Link>
        </div>
      )}
    </div>
  );
}

function resolveBikeImageUrl(b: JobBike, customerBikes?: { make: string; model: string | null; imageUrl: string | null }[]): string | null {
  const url = b.imageUrl ?? b.bike?.imageUrl ?? null;
  if (url) return url;
  if (!customerBikes?.length) return null;
  const makeNorm = (b.make ?? "").trim().toLowerCase();
  const modelNorm = (b.model ?? "").trim().toLowerCase();
  if (!makeNorm || !modelNorm) return null;
  const match = customerBikes.find(
    (cb) =>
      (cb.make ?? "").trim().toLowerCase() === makeNorm &&
      (cb.model ?? "").trim().toLowerCase() === modelNorm
  );
  return match?.imageUrl ?? null;
}

type BikeTypeForm = "AUTO" | "REGULAR" | "E_BIKE";

function jobBikeToFormValue(b: JobBike): BikeTypeForm {
  if (b.bikeType === "REGULAR") return "REGULAR";
  if (b.bikeType === "E_BIKE") return "E_BIKE";
  return "AUTO";
}

function toPatchBikeRow(
  b: Pick<JobBike, "make" | "model" | "nickname" | "imageUrl" | "bikeId">,
  bikeType: BikeTypeForm
): {
  make: string;
  model: string | null;
  nickname: string | null;
  imageUrl: string | null;
  bikeId: string | null;
  bikeType?: "REGULAR" | "E_BIKE";
} {
  const base = {
    make: b.make,
    model: b.model,
    nickname: b.nickname ?? null,
    imageUrl: b.imageUrl ?? null,
    bikeId: b.bikeId ?? null,
  };
  if (bikeType === "AUTO") return base;
  return { ...base, bikeType };
}

function buildBikesPayloadForPatch(
  job: Job,
  changedIndex: number,
  newType: BikeTypeForm
) {
  const jobBikes = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (jobBikes.length > 0) {
    return jobBikes.map((b, i) =>
      toPatchBikeRow(b, i === changedIndex ? newType : jobBikeToFormValue(b))
    );
  }
  return [
    toPatchBikeRow(
      {
        make: job.bikeMake,
        model: job.bikeModel,
        nickname: null,
        imageUrl: null,
        bikeId: null,
      },
      newType
    ),
  ];
}

function InternalNotesSection({
  job,
  onJobUpdated,
}: {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}) {
  const [value, setValue] = useState(job.internalNotes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(job.internalNotes ?? "");
  }, [job.id, job.internalNotes]);

  const persist = async () => {
    if (!onJobUpdated) return;
    const trimmed = value.trim();
    const current = (job.internalNotes ?? "").trim();
    if (trimmed === current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNotes: trimmed || null }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Job;
        onJobUpdated(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
          Internal Notes
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          Staff only
        </span>
      </div>
      {onJobUpdated ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={persist}
          disabled={saving}
          rows={3}
          placeholder="Add private notes about this job — not visible to the customer…"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none disabled:opacity-60 placeholder:text-slate-400"
        />
      ) : (
        value ? (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{value}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">No internal notes.</p>
        )
      )}
      {saving && <p className="text-xs text-slate-400 mt-1">Saving…</p>}
    </div>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

function shouldLeaveWaitingOnPartsColumn(job: Job, exceptBikeId: string): boolean {
  if (job.stage !== "WAITING_ON_PARTS") return false;
  return !(job.jobBikes ?? []).some(
    (b) => b.id !== exceptBikeId && !!b.waitingOnPartsAt && !b.completedAt
  );
}

function JobBikeSection({
  job,
  onJobUpdated,
}: {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}) {
  const jobBikes: JobBike[] = job.jobBikes ?? [];
  const hasMultiple = jobBikes.length > 1;
  const bikes = hasMultiple || jobBikes.length === 1
    ? jobBikes
    : [{ id: "legacy", make: job.bikeMake, model: job.bikeModel, nickname: null, imageUrl: null, bikeId: null, sortOrder: 0, bikeType: null } as JobBike];
  const customerBikes = job.customer?.bikes;
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [editingBikeIndex, setEditingBikeIndex] = useState<number | null>(null);
  const [savingWorkingOn, setSavingWorkingOn] = useState(false);
  const [savingComplete, setSavingComplete] = useState<string | null>(null);
  const [savingWaiting, setSavingWaiting] = useState<string | null>(null);
  const [addingBike, setAddingBike] = useState(false);
  const [addBikeSelectValue, setAddBikeSelectValue] = useState("");

  // Customer bikes not yet on this job
  const existingBikeIds = new Set(jobBikes.map((jb) => jb.bikeId).filter(Boolean));
  const availableToAdd = (customerBikes ?? []).filter((cb) => !existingBikeIds.has(cb.id));

  const handleAddSavedBike = async (bike: NonNullable<typeof customerBikes>[number]) => {
    if (!onJobUpdated) return;
    setAddingBike(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addBike: {
            make: bike.make,
            model: bike.model,
            nickname: bike.nickname ?? null,
            imageUrl: bike.imageUrl ?? null,
            bikeId: bike.id,
            bikeType: bike.bikeType ?? undefined,
          },
        }),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setAddingBike(false);
    }
  };

  useEffect(() => {
    setEditingBikeIndex(null);
  }, [job.id]);

  const handleBikeTypeChange = async (bikeIndex: number, value: string) => {
    if (!onJobUpdated) return;
    const newType = value as BikeTypeForm;
    setSavingIndex(bikeIndex);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bikes: buildBikesPayloadForPatch(job, bikeIndex, newType),
        }),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
        setEditingBikeIndex(null);
      }
    } finally {
      setSavingIndex(null);
    }
  };

  const handleToggleWorkingOn = async (bikeId: string) => {
    if (!onJobUpdated || savingWorkingOn) return;
    const nextId = job.workingOnJobBikeId === bikeId ? null : bikeId;
    setSavingWorkingOn(true);
    try {
      const body: Record<string, unknown> = { workingOnJobBikeId: nextId };
      if (nextId && job.stage !== "WORKING_ON") {
        body.stage = "WORKING_ON";
        body.notifyCustomer = false;
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setSavingWorkingOn(false);
    }
  };

  const handleToggleComplete = async (bikeId: string, isCompleted: boolean) => {
    if (!onJobUpdated || savingComplete) return;
    setSavingComplete(bikeId);
    try {
      const body = isCompleted
        ? { uncompleteJobBikeId: bikeId }
        : { completeJobBikeId: bikeId };
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setSavingComplete(null);
    }
  };

  const handleWaitForParts = async (bikeId: string) => {
    if (!onJobUpdated || savingWaiting) return;
    setSavingWaiting(bikeId);
    try {
      const body: Record<string, unknown> = { waitForPartsJobBikeId: bikeId };
      if (job.stage !== "WAITING_ON_PARTS") {
        body.stage = "WAITING_ON_PARTS";
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setSavingWaiting(null);
    }
  };

  const handleResumeWork = async (bikeId: string) => {
    if (!onJobUpdated || savingWaiting) return;
    setSavingWaiting(bikeId);
    try {
      const body: Record<string, unknown> = {
        unwaitForPartsJobBikeId: bikeId,
        workingOnJobBikeId: bikeId,
      };
      if (shouldLeaveWaitingOnPartsColumn(job, bikeId)) {
        body.stage = "WORKING_ON";
        body.notifyCustomer = false;
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setSavingWaiting(null);
    }
  };

  const handleClearWaitingOnPartsOnly = async (bikeId: string) => {
    if (!onJobUpdated || savingWaiting) return;
    setSavingWaiting(bikeId);
    try {
      const body: Record<string, unknown> = { unwaitForPartsJobBikeId: bikeId };
      if (shouldLeaveWaitingOnPartsColumn(job, bikeId)) {
        body.stage = "WORKING_ON";
        body.notifyCustomer = false;
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updatedJob = (await res.json()) as Job;
        onJobUpdated(updatedJob);
      }
    } finally {
      setSavingWaiting(null);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
        {hasMultiple ? `Bikes (${bikes.length})` : "Bike"}
      </h3>
      <div className={`grid gap-3 ${hasMultiple ? "grid-cols-1 sm:grid-cols-2" : ""}`}>
        {bikes.map((b, i) => {
          const dp = getDisplayPartsForJobBikeRow(job, b);
          const makeModel = [dp.make, dp.model].filter(Boolean).join(" ");
          const displayName = dp.nickname?.trim() ? dp.nickname : makeModel;
          const subtitle = dp.nickname?.trim() ? makeModel : null;
          const imageUrl =
            dp.imageUrl ?? resolveBikeImageUrl({ ...b, make: dp.make, model: dp.model }, customerBikes);
          const size = hasMultiple ? "w-16 h-16" : "w-24 h-24";
          const isEditing = onJobUpdated && editingBikeIndex === i;
          const isWorkingOn = b.id !== "legacy" && job.workingOnJobBikeId === b.id;
          const isCompleted = !!b.completedAt;
          // Never show waiting for the bike currently marked as working (clears badge even if GET/PATCH order left stale waitingOnPartsAt).
          const isWaitingOnParts =
            !!b.waitingOnPartsAt && !isCompleted && job.workingOnJobBikeId !== b.id;
          /** DB inconsistency: working on this bike but parts flag still set — offer clear, not another "waiting" control. */
          const stalePartsFlagWhileWorkingOn =
            isWorkingOn && !!b.waitingOnPartsAt && !isCompleted;
          const canInteract = onJobUpdated && b.id !== "legacy";

          return (
            <div
              key={b.id}
              className={`flex gap-3 rounded-xl border p-3 shadow-sm min-w-0 transition-colors ${
                isCompleted
                  ? "border-emerald-300 bg-emerald-50/50"
                  : isWaitingOnParts
                    ? "border-red-300 bg-red-50/50 ring-1 ring-red-200"
                    : isWorkingOn
                      ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-300"
                      : "border-slate-200 bg-white"
              } ${hasMultiple ? "" : "flex-1"}`}
            >
              {imageUrl ? (
                <div className={`${size} flex-shrink-0 relative rounded-lg overflow-hidden border border-slate-100`}>
                  <Image
                    src={imageUrl}
                    alt={displayName}
                    fill
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className={`${size} flex-shrink-0 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center`}>
                  <BikePlaceholderIcon className="w-8 h-8 text-slate-400" />
                </div>
              )}
              <div className="min-w-0 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-1">
                  <p className={`font-medium truncate ${isCompleted || isWaitingOnParts ? "text-slate-500" : "text-slate-900"}`}>{displayName}</p>
                  {isCompleted && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Done
                    </span>
                  )}
                  {isWaitingOnParts && !isCompleted && (
                    canInteract ? (
                      <button
                        type="button"
                        onClick={() => handleClearWaitingOnPartsOnly(b.id)}
                        disabled={!!savingWaiting}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-200 px-1.5 py-0.5 rounded-md whitespace-nowrap hover:bg-red-300 transition-colors disabled:opacity-50"
                        title="Remove waiting on parts if this was a mistake"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        Waiting on parts
                      </button>
                    ) : (
                      <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        Waiting on parts
                      </span>
                    )
                  )}
                  {isWorkingOn && !isCompleted && !isWaitingOnParts && (
                    canInteract ? (
                      <button
                        type="button"
                        onClick={() => handleToggleWorkingOn(b.id)}
                        disabled={savingWorkingOn}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-md whitespace-nowrap hover:bg-amber-300 transition-colors disabled:opacity-50"
                        title="Stop showing this bike as working on"
                      >
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-600 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600" />
                        </span>
                        Working on
                      </button>
                    ) : (
                      <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-600 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600" />
                        </span>
                        Working on
                      </span>
                    )
                  )}
                </div>
                {subtitle && <p className="text-sm text-slate-500 truncate">{subtitle}</p>}

                {!onJobUpdated && (
                  <p className="text-xs text-slate-500 mt-1.5">
                    {resolveEffectiveBikeType({
                      bikeType: b.bikeType,
                      make: dp.make,
                      model: dp.model,
                      bikeId: b.bikeId,
                      bike: b.bike,
                    }) === "E_BIKE"
                      ? "E-bike"
                      : "Standard bike"}
                  </p>
                )}

                {onJobUpdated && !isEditing && (
                  <div className="flex items-start justify-between gap-2 mt-1.5">
                    <p className="text-xs text-slate-600 min-w-0 leading-snug">
                      <span className="text-slate-400">Type:</span>{" "}
                      {formatBikeTypeDisplayLineForJob(job, b)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditingBikeIndex(i)}
                      className="flex-shrink-0 p-1 -mr-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
                      aria-label="Edit bike type"
                      title="Edit bike type"
                    >
                      <PencilIcon />
                    </button>
                  </div>
                )}

                {onJobUpdated && isEditing && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={jobBikeToFormValue(b)}
                      onChange={(e) => handleBikeTypeChange(i, e.target.value)}
                      disabled={savingIndex !== null}
                      className="w-full text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60"
                    >
                      <option value="AUTO">Auto (from make/model)</option>
                      <option value="REGULAR">Standard bike</option>
                      <option value="E_BIKE">E-bike</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditingBikeIndex(null)}
                      disabled={savingIndex !== null}
                      className="text-xs text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {canInteract && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isCompleted ? (
                      <button
                        type="button"
                        onClick={() => handleToggleComplete(b.id, true)}
                        disabled={!!savingComplete}
                        className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50"
                        title="Undo done — mark this bike as not completed"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 010 10H9m-6-6l3-3m0 0l3 3m-3-3v12" />
                        </svg>
                        Undo done
                      </button>
                    ) : isWaitingOnParts ? (
                      <button
                        type="button"
                        onClick={() => handleResumeWork(b.id)}
                        disabled={!!savingWaiting}
                        className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50"
                        title="Parts arrived — resume working on this bike"
                      >
                        <WrenchIcon className="w-3.5 h-3.5" />
                        Resume work
                      </button>
                    ) : isWorkingOn ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleComplete(b.id, false)}
                          disabled={!!savingComplete}
                          className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50 shadow-sm"
                          title="Mark this bike as done"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Mark done
                        </button>
                        {stalePartsFlagWhileWorkingOn ? (
                          <button
                            type="button"
                            onClick={() => handleClearWaitingOnPartsOnly(b.id)}
                            disabled={!!savingWaiting}
                            className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50"
                            title="Remove the parts hold on this bike (fixes stuck status after moving columns)"
                          >
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            Clear parts hold
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleWaitForParts(b.id)}
                            disabled={!!savingWaiting}
                            className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-red-50 hover:text-red-800 hover:border-red-200 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50"
                            title="Mark this bike as waiting on parts (customer sees this status)"
                          >
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                            </svg>
                            Need parts
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleWorkingOn(b.id)}
                        disabled={savingWorkingOn}
                        className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-800 transition-colors touch-manipulation min-h-[32px] disabled:opacity-50"
                        title="Mark as working on this bike"
                      >
                        <WrenchIcon className="w-3.5 h-3.5" />
                        Work on this
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {onJobUpdated && availableToAdd.length > 0 && (
        <div className="mt-3">
          <select
            value={addBikeSelectValue}
            disabled={addingBike}
            onChange={(e) => {
              const id = e.target.value;
              const bike = availableToAdd.find((b) => b.id === id);
              if (bike) {
                setAddBikeSelectValue("");
                handleAddSavedBike(bike);
              }
            }}
            className="text-sm rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            <option value="" disabled>
              {addingBike ? "Adding…" : "+ Add saved bike"}
            </option>
            {availableToAdd.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nickname ? `${b.nickname} (${[b.make, b.model].filter(Boolean).join(" ")})` : [b.make, b.model].filter(Boolean).join(" ")}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}


const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_CUSTOMER: "Waiting on Customer",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STAGE_COLORS: Record<Stage, string> = {
  PENDING_APPROVAL: "bg-amber-600",
  BOOKED_IN: "bg-slate-500",
  RECEIVED: "bg-slate-600",
  WORKING_ON: "bg-amber-600",
  WAITING_ON_CUSTOMER: "bg-violet-600",
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

function toDateTimeLocalValue(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateTimeToMillis(local: string): number | null {
  const t = local.trim();
  if (!t) return null;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function jobDateToMillis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function JobDetailsDateFields({
  job,
  onJobUpdated,
  onDateSaved,
}: {
  job: Job;
  onJobUpdated?: (job: Job) => void;
  onDateSaved?: (field: "dropOffDate" | "pickupDate" | "collectionWindow", jobId: string) => void;
}) {
  const [dropOff, setDropOff] = useState(() => toDateTimeLocalValue(job.dropOffDate));
  const [pickup, setPickup] = useState(() => toDateTimeLocalValue(job.pickupDate));
  const [windowStart, setWindowStart] = useState(job.collectionWindowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(job.collectionWindowEnd ?? "");
  const [savingField, setSavingField] = useState<"dropOffDate" | "pickupDate" | "collectionWindow" | null>(null);

  useEffect(() => {
    setDropOff(toDateTimeLocalValue(job.dropOffDate));
    setPickup(toDateTimeLocalValue(job.pickupDate));
    setWindowStart(job.collectionWindowStart ?? "");
    setWindowEnd(job.collectionWindowEnd ?? "");
  }, [job.id, job.dropOffDate, job.pickupDate, job.collectionWindowStart, job.collectionWindowEnd]);

  const isCollection = job.deliveryType === "COLLECTION_SERVICE";
  const firstLabel = isCollection ? "Collection pickup" : "Drop-off";
  const secondLabel = isCollection ? "Collection return" : "Pickup";

  const persist = async (field: "dropOffDate" | "pickupDate", localVal: string) => {
    if (!onJobUpdated) return;
    const nextMs = localDateTimeToMillis(localVal);
    const currentIso = field === "dropOffDate" ? job.dropOffDate : job.pickupDate;
    const currentMs = jobDateToMillis(currentIso ?? undefined);
    if (nextMs === currentMs) return;

    setSavingField(field);
    try {
      const body =
        nextMs === null
          ? { [field]: null }
          : { [field]: new Date(localVal.trim()).toISOString() };
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = (await res.json()) as Job;
        onJobUpdated(updated);
        onDateSaved?.(field, job.id);
      }
    } finally {
      setSavingField(null);
    }
  };

  const persistWindow = async (start: string, end: string) => {
    if (!onJobUpdated) return;
    if (start === (job.collectionWindowStart ?? "") && end === (job.collectionWindowEnd ?? "")) return;
    setSavingField("collectionWindow");
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionWindowStart: start || null,
          collectionWindowEnd: end || null,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Job;
        onJobUpdated(updated);
        onDateSaved?.("collectionWindow", job.id);
      }
    } finally {
      setSavingField(null);
    }
  };

  const formatWindow = (start: string | null, end: string | null) => {
    if (!start && !end) return null;
    const fmt = (t: string) => {
      const [h, m] = t.split(":");
      const hour = parseInt(h, 10);
      const ampm = hour >= 12 ? "pm" : "am";
      const h12 = hour % 12 || 12;
      return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
    };
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return `from ${fmt(start)}`;
    return `until ${fmt(end!)}`;
  };

  if (!onJobUpdated) {
    const windowDisplay = isCollection ? formatWindow(job.collectionWindowStart, job.collectionWindowEnd) : null;
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</h3>
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="text-slate-500 inline">{firstLabel}:</dt>{" "}
            <dd className="inline text-slate-900">{formatDate(job.dropOffDate)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <div>
              <dt className="text-slate-500 inline">{secondLabel}:</dt>{" "}
              <dd className="inline text-slate-900">{formatDate(job.pickupDate)}</dd>
            </div>
            {windowDisplay && (
              <dd className="inline-flex items-center gap-1 text-slate-600">
                <span className="text-slate-400 text-xs">·</span>
                <span>{windowDisplay}</span>
              </dd>
            )}
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</h3>
      {isCollection ? (
        <div className="space-y-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-600 mb-1">{firstLabel}</label>
            <input
              type="datetime-local"
              value={dropOff}
              onChange={(e) => setDropOff(e.target.value)}
              onBlur={() => persist("dropOffDate", dropOff)}
              disabled={savingField !== null}
              className="w-full max-w-full min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1" style={{ minWidth: "180px" }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{secondLabel}</label>
                <input
                  type="datetime-local"
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  onBlur={() => persist("pickupDate", pickup)}
                  disabled={savingField !== null}
                  className="w-full max-w-full min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
                />
              </div>
              <div className="flex items-end gap-1 flex-shrink-0">
                <div className="min-w-0">
                  <label className="block text-[11px] text-slate-500 mb-1">Window from</label>
                  <input
                    type="time"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    onBlur={() => persistWindow(windowStart, windowEnd)}
                    disabled={savingField !== null}
                    className="w-[110px] max-w-full min-w-0 px-2 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
                  />
                </div>
                <span className="text-slate-400 pb-2.5 text-sm">–</span>
                <div className="min-w-0">
                  <label className="block text-[11px] text-slate-500 mb-1">To</label>
                  <input
                    type="time"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    onBlur={() => persistWindow(windowStart, windowEnd)}
                    disabled={savingField !== null}
                    className="w-[110px] max-w-full min-w-0 px-2 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-600 mb-1">{firstLabel}</label>
            <input
              type="datetime-local"
              value={dropOff}
              onChange={(e) => setDropOff(e.target.value)}
              onBlur={() => persist("dropOffDate", dropOff)}
              disabled={savingField !== null}
              className="w-full max-w-full min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-600 mb-1">{secondLabel}</label>
            <input
              type="datetime-local"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              onBlur={() => persist("pickupDate", pickup)}
              disabled={savingField !== null}
              className="w-full max-w-full min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-60 box-border"
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface JobDetailModalProps {
  job: Job | null;
  isOpen: boolean;
  onClose: () => void;
  onJobUpdated?: (job: Job) => void;
  onDismissIntent?: () => void;
  onJobDateSaved?: (field: "dropOffDate" | "pickupDate" | "collectionWindow", jobId: string) => void;
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

function RecordCashButton({
  jobId,
  total,
  onRecorded,
}: {
  jobId: string;
  total: number;
  onRecorded?: (job: Job) => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatted = total.toLocaleString("en-US", { style: "currency", currency: "USD" });

  useEffect(() => {
    if (!showConfirm) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !recording) {
        e.stopImmediatePropagation();
        setShowConfirm(false);
      }
    };
    document.addEventListener("keydown", fn, true);
    return () => document.removeEventListener("keydown", fn, true);
  }, [showConfirm, recording]);

  const handleRecord = async () => {
    setRecording(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/payments/record-cash`, { method: "POST" });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
        onRecorded?.(updatedJob);
        setShowConfirm(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to record cash payment");
      }
    } finally {
      setRecording(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={recording}
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        {recording ? "Recording…" : "Record cash"}
      </button>

      {showConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && !recording && setShowConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-cash-modal-title"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-200/80 bg-white p-6 shadow-soft-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h2 id="record-cash-modal-title" className="text-lg font-semibold text-slate-900">
                  Record cash payment
                </h2>
                <p className="text-sm text-slate-600">
                  {formatted} will be marked as paid. Move the card to Completed when the bike is actually picked up.
                </p>
              </div>
            </div>
            {error && (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => !recording && setShowConfirm(false)}
                disabled={recording}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecord}
                disabled={recording}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-soft"
              >
                {recording ? "Recording…" : `Record ${formatted}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReprocessStripeButton({
  jobId,
  onReprocessed,
}: {
  jobId: string;
  onReprocessed?: (job: Job) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [piId, setPiId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showModal) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        e.stopImmediatePropagation();
        setShowModal(false);
      }
    };
    document.addEventListener("keydown", fn, true);
    return () => document.removeEventListener("keydown", fn, true);
  }, [showModal, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/payments/reprocess-stripe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId: piId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
        onReprocessed?.(updatedJob);
        setShowModal(false);
        setPiId("");
      } else {
        setError(data.error ?? "Failed to reprocess payment");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setShowModal(true); setError(null); setPiId(""); }}
        className="inline-flex items-center gap-1.5 self-start text-sm text-slate-400 hover:text-slate-600"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Reprocess Stripe payment
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && !loading && setShowModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reprocess-stripe-modal-title"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-200/80 bg-white p-6 shadow-soft-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <h2 id="reprocess-stripe-modal-title" className="text-lg font-semibold text-slate-900">
                  Reprocess Stripe payment
                </h2>
                <p className="text-sm text-slate-500">
                  Paste the Payment Intent ID from Stripe Dashboard to manually apply a succeeded payment.
                </p>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="pi-id-input" className="block text-sm font-medium text-slate-700 mb-1">
                  Payment Intent ID
                </label>
                <input
                  ref={inputRef}
                  id="pi-id-input"
                  type="text"
                  value={piId}
                  onChange={(e) => setPiId(e.target.value)}
                  placeholder="pi_3ABC..."
                  disabled={loading}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Find this in Stripe Dashboard → Payments → click the payment → copy the ID starting with <span className="font-mono">pi_</span>
                </p>
              </div>
              {error && (
                <p className="text-sm text-red-600" role="alert">{error}</p>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => !loading && setShowModal(false)}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !piId.trim().startsWith("pi_")}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-soft"
                >
                  {loading ? "Processing…" : "Apply payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
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

function mergeJobPreservingInvoiceDetails(prev: Job, next: Job): Job {
  const merged = { ...prev, ...next };
  const nextServices = next.jobServices ?? [];
  const nextProducts = next.jobProducts ?? [];

  if (nextServices.length > 0 && nextServices.some((js) => !js.id)) {
    merged.jobServices = prev.jobServices;
  }
  if (nextProducts.length > 0 && nextProducts.some((jp) => !jp.id || !jp.productId)) {
    merged.jobProducts = prev.jobProducts;
  }

  return merged;
}

export function JobDetailModal({ job: jobProp, isOpen, onClose, onJobUpdated, onDismissIntent, onJobDateSaved, onJobDeleted }: JobDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonOther, setCancelReasonOther] = useState("");
  const [job, setJob] = useState<Job | null>(jobProp);
  const [sendingReview, setSendingReview] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [reviewBanner, setReviewBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const latestJobPropRef = useRef(jobProp);
  latestJobPropRef.current = jobProp;
  const onJobUpdatedRef = useRef(onJobUpdated);

  useEffect(() => {
    onJobUpdatedRef.current = onJobUpdated;
  }, [onJobUpdated]);

  // Mirror parent job when it changes (e.g. kanban drag PATCH updates selectedJob — same id, new object)
  useEffect(() => {
    setJob((prev) => {
      if (!jobProp) return jobProp;
      if (!prev || prev.id !== jobProp.id) return jobProp;

      const prevMs = Date.parse(prev.updatedAt);
      const nextMs = Date.parse(jobProp.updatedAt);
      if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs < prevMs) {
        return prev;
      }

      // Merge so lightweight board refreshes don't clobber invoice line relations.
      return mergeJobPreservingInvoiceDetails(prev, jobProp);
    });
  }, [jobProp]);

  // One GET per modal open (per job id) to enrich linked bike data. A slow response must not overwrite
  // a newer job from the parent (e.g. board drag PATCH cleared waiting flags; GET started at open still has old rows).
  useEffect(() => {
    if (!isOpen || !jobProp?.id) return;
    const ac = new AbortController();
    const openedJobId = jobProp.id;
    fetch(`/api/jobs/${openedJobId}`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((fetched: Job | null) => {
        if (!fetched || ac.signal.aborted) return;
        const live = latestJobPropRef.current;
        if (!live || live.id !== openedJobId) return;
        const fetchedMs = Date.parse(fetched.updatedAt);
        const liveMs = Date.parse(live.updatedAt);
        if (Number.isFinite(fetchedMs) && Number.isFinite(liveMs) && fetchedMs < liveMs) return;
        setJob(fetched);
        // Keep the parent (board/archive list) in sync so the card updates too.
        onJobUpdatedRef.current?.(fetched);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [isOpen, jobProp?.id]);

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

  const handleAcceptBooking = async () => {
    if (!job) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "BOOKED_IN" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJob(updated);
        onJobUpdated?.(updated);
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleRejectBookingConfirm = async () => {
    if (!job || !rejectReason.trim()) return;
    setRejectSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "CANCELLED",
          cancellationReason: rejectReason.trim(),
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJob(updated);
        onJobUpdated?.(updated);
        setShowRejectReason(false);
        setRejectReason("");
      }
    } finally {
      setRejectSubmitting(false);
    }
  };

  const canConfirmCancellation =
    cancelReason &&
    (cancelReason !== "Other" || cancelReasonOther.trim().length > 0);

  const handleDeleteJobClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteJobConfirm = async () => {
    if (!job) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
      if (res.ok) {
        onJobDeleted?.(job.id);
        setShowDeleteConfirm(false);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!job) return;
    setArchiving(true);
    try {
      const nextArchived = !job.archivedAt;
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJob(updated);
        onJobUpdated?.(updated);
      }
    } finally {
      setArchiving(false);
    }
  };

  const handleSendReviewRequest = async () => {
    if (!job) return;
    const email = job.customer?.email?.trim();
    if (!email) return;
    setSendingReview(true);
    setReviewBanner(null);
    try {
      const customerName = job.customer
        ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ")
        : undefined;
      const res = await fetch("/api/review-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          customerId: job.customer?.id,
          email,
          customerName,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setReviewBanner({ ok: false, text: data.error ?? "Failed to send review request." });
      } else {
        setReviewBanner({ ok: true, text: `Review request sent to ${email}.` });
        setTimeout(() => setReviewBanner(null), 5000);
      }
    } catch {
      setReviewBanner({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setSendingReview(false);
    }
  };

  const handleDismissClose = () => {
    onDismissIntent?.();
    onClose();
  };

  useEffect(() => {
    if (job) {
      setActiveTab("details");
      setShowCancelReason(false);
      setShowDeleteConfirm(false);
      setCancelReason("");
      setCancelReasonOther("");
      setReviewBanner(null);
      setShowRejectReason(false);
      setRejectReason("");
    }
    // Only when switching jobs — same-id refreshes (invoice lines, refetch) must not reset tab or overlays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  useEffect(() => {
    if (!showDeleteConfirm) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
        e.stopImmediatePropagation();
        setShowDeleteConfirm(false);
      }
    };
    document.addEventListener("keydown", fn, true);
    return () => document.removeEventListener("keydown", fn, true);
  }, [showDeleteConfirm, deleting]);

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
    <>
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onDismissIntent?.();
      }}
      onClick={handleDismissClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-soft-lg w-full max-w-lg sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] flex flex-col relative border border-slate-200/80 sm:border-t-0"
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
        {showRejectReason && (
          <div className="absolute inset-0 z-10 flex flex-col bg-white/95 rounded-xl p-6 overflow-hidden">
            <h3 className="text-lg font-semibold text-slate-900 flex-shrink-0 mb-1">
              Reject Booking
            </h3>
            <p className="text-sm text-slate-500 mb-4 flex-shrink-0">
              The customer will see this reason on the status page and by email.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection…"
              rows={4}
              autoFocus
              className="w-full flex-1 min-h-0 px-3 py-2 border border-slate-300 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
            />
            <div className="flex gap-2 justify-end pt-4 flex-shrink-0 border-t border-slate-200 mt-4">
              <button
                onClick={() => { setShowRejectReason(false); setRejectReason(""); }}
                disabled={rejectSubmitting}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleRejectBookingConfirm}
                disabled={rejectSubmitting || !rejectReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rejectSubmitting ? "Rejecting…" : "Reject booking"}
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate pr-2">
            {getJobBikeDisplayTitle(job)}
          </h2>
          <button
            onPointerDown={onDismissIntent}
            onClick={handleDismissClose}
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
            <InvoiceTab
              job={job}
              onJobUpdated={(updated) => {
                setJob(updated);
                onJobUpdated?.(updated);
              }}
            />
          ) : (
            <>
          {job.stage === "PENDING_APPROVAL" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-bold text-amber-800">New Booking Request</p>
              </div>
              <p className="text-sm text-amber-700">
                Review this request and accept or reject it. The customer will be notified by email and SMS.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAcceptBooking}
                  disabled={accepting}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {accepting ? "Accepting…" : "Accept"}
                </button>
                <button
                  type="button"
                  onClick={() => { setRejectReason(""); setShowRejectReason(true); }}
                  disabled={accepting}
                  className="flex-1 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
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
            {job.paymentStatus === "PAID" ? (
              <span className="text-xs font-medium px-2 py-1 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">
                Paid
              </span>
            ) : job.paymentStatus === "PENDING" ? (
              <span className="text-xs font-medium px-2 py-1 rounded bg-amber-100 text-amber-800 whitespace-nowrap">
                Partially paid
              </span>
            ) : null}
          </div>

          {job.customer && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                  Customer
                </h3>
                <Link
                  href={`/settings/customers?edit=${job.customer.id}`}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline shrink-0 touch-manipulation"
                >
                  Edit
                </Link>
              </div>
              <p className="font-medium text-slate-900">
                {job.customer.lastName
                  ? `${job.customer.firstName} ${job.customer.lastName}`
                  : job.customer.firstName}
              </p>
              {job.customer.email && (
                <a
                  href={`mailto:${job.customer.email}`}
                  className="block text-sm text-slate-600 hover:text-slate-800"
                >
                  {job.customer.email}
                </a>
              )}
              {job.customer.phone && (
                <a
                  href={phoneTelHref(job.customer.phone)}
                  className="phone-link-touch block text-sm text-slate-600 hover:text-slate-800"
                >
                  {formatPhoneDisplay(job.customer.phone)}
                </a>
              )}
              {job.customer.phone && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-600">SMS consent</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        job.customer.smsConsent
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      {job.customer.smsConsent ? "Consented" : "Not consented"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {job.customer.smsConsent
                      ? `Customer opted in${
                          job.customer.smsConsentSource
                            ? ` via ${job.customer.smsConsentSource.replace(/_/g, " ").toLowerCase()}`
                            : ""
                        }${
                          job.customer.smsConsentUpdatedAt
                            ? ` on ${new Date(job.customer.smsConsentUpdatedAt).toLocaleDateString()}`
                            : ""
                        }.`
                      : "Customer has not opted in to service-related SMS."}
                  </p>
                </div>
              )}
              {job.customer.email && job.stage !== "CANCELLED" && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleSendReviewRequest}
                    disabled={sendingReview}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
                  >
                    {sendingReview ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                        Send review request
                      </>
                    )}
                  </button>
                  {reviewBanner && (
                    <p className={`mt-2 text-xs ${reviewBanner.ok ? "text-emerald-600" : "text-red-600"}`}>
                      {reviewBanner.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <JobBikeSection
            job={job}
            onJobUpdated={(updated) => {
              setJob(updated);
              onJobUpdated?.(updated);
            }}
          />

          <JobDetailsDateFields
            job={job}
            onJobUpdated={(updated) => {
              setJob(updated);
              onJobUpdated?.(updated);
            }}
            onDateSaved={onJobDateSaved}
          />

          {/* Services & Products – quick reference on Details tab (no pricing; see Invoice tab) */}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Services & Products</h3>
            {(job.jobServices?.length ?? 0) === 0 && (job.jobProducts?.length ?? 0) === 0 ? (
              <p className="text-slate-500 text-sm">No services or products added</p>
            ) : (
              <div className="space-y-2">
                {(job.jobServices ?? []).map((js) => (
                  <div
                    key={js.id}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100 text-sm"
                  >
                    <span className="font-medium text-slate-900">
                      {js.service?.name ?? js.customServiceName ?? "Unknown"}
                      {js.quantity > 1 && (
                        <span className="text-slate-500 font-normal"> × {js.quantity}</span>
                      )}
                    </span>
                    {(job.jobBikes?.length ?? 0) > 1 && js.jobBikeId && (() => {
                      const jb = (job.jobBikes ?? []).find((b) => b.id === js.jobBikeId);
                      if (!jb) return null;
                      const dp = getDisplayPartsForJobBikeRow(job, jb);
                      return (
                        <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                          {dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ")}
                        </span>
                      );
                    })()}
                  </div>
                ))}
                {(job.jobProducts ?? []).map((jp) => (
                  <div
                    key={jp.id}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100 text-sm"
                  >
                    <span className="font-medium text-slate-900">
                      {jp.product?.name ?? "Unknown"}
                      {jp.quantity > 1 && (
                        <span className="text-slate-500 font-normal"> × {jp.quantity}</span>
                      )}
                    </span>
                    {(job.jobBikes?.length ?? 0) > 1 && jp.jobBikeId && (() => {
                      const jb = (job.jobBikes ?? []).find((b) => b.id === jp.jobBikeId);
                      if (!jb) return null;
                      const dp = getDisplayPartsForJobBikeRow(job, jb);
                      return (
                        <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                          {dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ")}
                        </span>
                      );
                    })()}
                  </div>
                ))}
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

          {(job.customerNotes || job.notes || (job.stage === "CANCELLED" && job.cancellationReason)) && (
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
              </div>
            </div>
          )}

          <InternalNotesSection
            job={job}
            onJobUpdated={(updated) => {
              setJob(updated);
              onJobUpdated?.(updated);
            }}
          />

          {job.customer && <CustomerChatSection customerId={job.customer.id} />}
            </>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex gap-2">
            <button
              onClick={handleToggleArchive}
              disabled={archiving}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {archiving
                ? job.archivedAt
                  ? "Unarchiving…"
                  : "Archiving…"
                : job.archivedAt
                  ? "Unarchive"
                  : "Archive"}
            </button>
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
              onClick={handleDeleteJobClick}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-red-800 bg-red-100 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete Job"}
            </button>
          </div>
        </div>
      </div>
    </div>
    {showDeleteConfirm && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && !deleting && setShowDeleteConfirm(false)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-job-modal-title"
      >
        <div
          className="w-full max-w-sm rounded-xl border border-slate-200/80 bg-white p-6 shadow-soft-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 flex-shrink-0">
              <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h2 id="delete-job-modal-title" className="text-lg font-semibold text-slate-900">
                Delete job?
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Permanently delete this job? This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => !deleting && setShowDeleteConfirm(false)}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteJobConfirm}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors shadow-soft"
            >
              {deleting ? "Deleting…" : "Delete Job"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function InvoiceTab({ job, onJobUpdated }: { job: Job; onJobUpdated?: (job: Job) => void }) {
  const [services, setServices] = useState<{ id: string; name: string; price: number | string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; price: number | string }[]>([]);
  const [searchedProducts, setSearchedProducts] = useState<{ id: string; name: string; price: number | string }[] | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingProduct, setRemovingProduct] = useState<string | null>(null);
  const [updatingServiceQty, setUpdatingServiceQty] = useState<string | null>(null);
  const [updatingServicePrice, setUpdatingServicePrice] = useState<string | null>(null);
  const [updatingServiceBike, setUpdatingServiceBike] = useState<string | null>(null);
  const [updatingProductBike, setUpdatingProductBike] = useState<string | null>(null);
  const [updatingProductPrice, setUpdatingProductPrice] = useState<string | null>(null);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const [productsDropdownOpen, setProductsDropdownOpen] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [expandedServiceIds, setExpandedServiceIds] = useState<Set<string>>(new Set());
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [expandedBikeIds, setExpandedBikeIds] = useState<Set<string>>(() => {
    const bikes = job.jobBikes ?? [];
    const ids = new Set<string>();
    if (bikes.length === 0) {
      ids.add("__legacy__");
    } else {
      bikes.forEach((b) => ids.add(b.id));
    }
    ids.add("__unassigned__");
    return ids;
  });
  const servicesDropdownRef = useRef<HTMLDivElement>(null);
  const productsDropdownRef = useRef<HTMLDivElement>(null);
  const serviceSearchRef = useRef<HTMLInputElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async (query = "") => {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams({ ts: String(Date.now()) });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const nextProducts = (Array.isArray(data) ? data : []).map((p: { id: string; name: string; price: unknown }) => ({
          id: p.id,
          name: p.name,
          price: typeof p.price === "string" ? parseFloat(p.price) : Number(p.price ?? 0),
        }));
      const trimmedQuery = query.trim();
      setProducts((prev) => {
        if (!trimmedQuery) return nextProducts;
        const byId = new Map(prev.map((p) => [p.id, p]));
        nextProducts.forEach((p) => byId.set(p.id, p));
        return Array.from(byId.values());
      });
      setSearchedProducts(trimmedQuery ? nextProducts : null);
    } catch {
      // Keep the current list if a background refresh fails.
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const toggleServiceExpanded = (id: string) => {
    setExpandedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProductExpanded = (id: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBikeExpanded = (key: string) => {
    setExpandedBikeIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!productsDropdownOpen) return;
    const search = productSearch.trim();
    if (!search) {
      setSearchedProducts(null);
      return;
    }
    setProductsLoading(true);
    const timer = window.setTimeout(() => {
      void loadProducts(search);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadProducts, productSearch, productsDropdownOpen]);

  useEffect(() => {
    const refreshProducts = () => {
      if (document.visibilityState === "visible") {
        void loadProducts();
      }
    };

    window.addEventListener("focus", refreshProducts);
    document.addEventListener("visibilitychange", refreshProducts);
    return () => {
      window.removeEventListener("focus", refreshProducts);
      document.removeEventListener("visibilitychange", refreshProducts);
    };
  }, [loadProducts]);

  const jobServices: JobService[] = job.jobServices ?? [];
  const jobProductsList: JobProduct[] = job.jobProducts ?? [];
  const attachedProductIds = new Set(jobProductsList.map((jp) => jp.productId));
  const filteredServices = serviceSearch.trim()
    ? services.filter((s) => s.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()))
    : services;
  const filteredProducts = productSearch.trim()
    ? searchedProducts ?? products.filter((p) => p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
    : products;

  const jobBikesList: JobBike[] = job.jobBikes ?? [];
  const isMultiBike = jobBikesList.length > 1;
  const invoiceCustomerBikes = job.customer?.bikes;

  const calcGroupSubtotal = (svcs: JobService[], prods: JobProduct[]) =>
    svcs.reduce((s, js) => {
      const p = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      return s + p * (js.quantity || 1);
    }, 0) +
    prods.reduce((s, jp) => {
      const p = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
      return s + p * (jp.quantity || 1);
    }, 0);

  const bikeGroups: Array<{
    key: string;
    bike: JobBike | null;
    services: JobService[];
    products: JobProduct[];
    subtotal: number;
  }> = (() => {
    if (jobBikesList.length === 0) {
      const legacyBike: JobBike = {
        id: "__legacy__",
        jobId: job.id,
        make: job.bikeMake,
        model: job.bikeModel,
        bikeType: null,
        nickname: null,
        imageUrl: null,
        bikeId: null,
        sortOrder: 0,
        completedAt: null,
        waitingOnPartsAt: null,
      };
      return [{ key: "__legacy__", bike: legacyBike, services: jobServices, products: jobProductsList, subtotal: calcGroupSubtotal(jobServices, jobProductsList) }];
    } else if (!isMultiBike) {
      const bike = jobBikesList[0];
      return [{ key: bike.id, bike, services: jobServices, products: jobProductsList, subtotal: calcGroupSubtotal(jobServices, jobProductsList) }];
    } else {
      const groups: Array<{ key: string; bike: JobBike | null; services: JobService[]; products: JobProduct[]; subtotal: number }> = jobBikesList.map((bike) => {
        const svcs = jobServices.filter((js) => js.jobBikeId === bike.id);
        const prods = jobProductsList.filter((jp) => jp.jobBikeId === bike.id);
        return { key: bike.id, bike, services: svcs, products: prods, subtotal: calcGroupSubtotal(svcs, prods) };
      });
      const unassignedSvcs = jobServices.filter((js) => !js.jobBikeId);
      const unassignedProds = jobProductsList.filter((jp) => !jp.jobBikeId);
      if (unassignedSvcs.length > 0 || unassignedProds.length > 0) {
        groups.push({ key: "__unassigned__", bike: null, services: unassignedSvcs, products: unassignedProds, subtotal: calcGroupSubtotal(unassignedSvcs, unassignedProds) });
      }
      return groups;
    }
  })();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (servicesDropdownRef.current && !servicesDropdownRef.current.contains(e.target as Node)) {
        setServicesDropdownOpen(false);
        setServiceSearch("");
      }
      if (productsDropdownRef.current && !productsDropdownRef.current.contains(e.target as Node)) {
        setProductsDropdownOpen(false);
        setProductSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddService = async (serviceId: string) => {
    setAdding(true);
    setServicesDropdownOpen(false);
    setServiceSearch("");
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

  const handleAddCustomService = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    setServicesDropdownOpen(false);
    setServiceSearch("");
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customServiceName: trimmed, unitPrice: 0 }),
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

  const adjustServiceQuantity = async (jobServiceId: string, quantity: number) => {
    if (quantity < 1) return;
    setUpdatingServiceQty(jobServiceId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobServiceId, quantity }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingServiceQty(null);
    }
  };

  const updateServiceUnitPrice = async (jobServiceId: string, unitPrice: number) => {
    setUpdatingServicePrice(jobServiceId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobServiceId, unitPrice }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingServicePrice(null);
    }
  };

  const updateProductUnitPrice = async (jobProductId: string, unitPrice: number) => {
    setUpdatingProductPrice(jobProductId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobProductId, unitPrice }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingProductPrice(null);
    }
  };

  const assignServiceBike = async (jobServiceId: string, jobBikeId: string | null) => {
    setUpdatingServiceBike(jobServiceId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobServiceId, jobBikeId }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingServiceBike(null);
    }
  };

  const applyServiceToAllBikes = async (jobServiceId: string) => {
    setUpdatingServiceBike(jobServiceId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobServiceId, applyToAllBikes: true }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingServiceBike(null);
    }
  };

  const assignProductBike = async (jobProductId: string, jobBikeId: string | null) => {
    setUpdatingProductBike(jobProductId);
    try {
      const res = await fetch(`/api/jobs/${job.id}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobProductId, jobBikeId }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setUpdatingProductBike(null);
    }
  };

  const handleAddProduct = async (productId: string) => {
    setAddingProduct(true);
    setProductsDropdownOpen(false);
    setProductSearch("");
    try {
      const res = await fetch(`/api/jobs/${job.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setAddingProduct(false);
    }
  };

  const handleRemoveProduct = async (jobProductId: string) => {
    setRemovingProduct(jobProductId);
    try {
      const res = await fetch(
        `/api/jobs/${job.id}/products?jobProductId=${encodeURIComponent(jobProductId)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const updatedJob = await fetch(`/api/jobs/${job.id}`).then((r) => r.json());
        onJobUpdated?.(updatedJob);
      }
    } finally {
      setRemovingProduct(null);
    }
  };

  const total =
    jobServices.reduce((sum, js) => {
      const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      return sum + price * (js.quantity || 1);
    }, 0) +
    jobProductsList.reduce((sum, jp) => {
      const price = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
      return sum + price * (jp.quantity || 1);
    }, 0);

  const grossPaid =
    typeof job.totalPaid === "number"
      ? job.totalPaid
      : 0;
  const paymentSummary = getJobPaymentSummary({
    currentStatus: job.paymentStatus,
    subtotal: total,
    totalPaid: grossPaid,
  });
  const paidTowardTotal = Math.min(paymentSummary.totalPaid, total);
  const remaining = paymentSummary.remaining;

  return (
    <div>
      <div className="space-y-3 mb-3">
        {bikeGroups.map((group) => {
          const isBikeOpen = expandedBikeIds.has(group.key);
          const itemCount = group.services.length + group.products.length;

          let bikeLabel = "Not assigned to a bike";
          let bikeImageUrl: string | null = null;
          let bikeTypeLabel = "";
          let bikeSubLabel = "";
          if (group.bike) {
            const dp = getDisplayPartsForJobBikeRow(job, group.bike);
            const bikeMakeModel = [dp.make, dp.model].filter(Boolean).join(" ");
            bikeLabel = dp.nickname?.trim() ? dp.nickname : bikeMakeModel;
            bikeSubLabel = dp.nickname?.trim() ? bikeMakeModel : "";
            bikeImageUrl = dp.imageUrl ?? resolveBikeImageUrl({ ...group.bike, make: dp.make, model: dp.model }, invoiceCustomerBikes);
            const eff = resolveEffectiveBikeType({
              bikeType: group.bike.bikeType,
              make: dp.make,
              model: dp.model,
              bikeId: group.bike.bikeId,
              bike: group.bike.bike,
            });
            bikeTypeLabel = eff === "E_BIKE" ? "E-bike" : "Standard";
          }

          return (
            <div key={group.key} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => toggleBikeExpanded(group.key)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span
                    className={`text-slate-400 transition-transform flex-shrink-0 ${isBikeOpen ? "rotate-90" : ""}`}
                    aria-hidden
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                  {group.bike && (
                    bikeImageUrl ? (
                      <Image src={bikeImageUrl} alt="" width={32} height={32} className="w-8 h-8 object-cover rounded border border-slate-200 flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <BikePlaceholderIcon className="w-4 h-4 text-slate-500" />
                      </div>
                    )
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900 text-sm truncate block">{bikeLabel}</span>
                    {(bikeSubLabel || bikeTypeLabel) && (
                      <span className="text-xs text-slate-500 truncate block">
                        {bikeSubLabel ? `${bikeSubLabel} · ` : ""}{bikeTypeLabel}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-slate-400 tabular-nums">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                  <Price amount={group.subtotal} variant="inline" />
                </div>
              </button>

              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: isBikeOpen ? "1fr" : "0fr" }}
              >
                <div className="min-h-0 overflow-hidden">
                  {itemCount === 0 ? (
                    <p className="text-slate-400 text-sm px-3 py-3">No services or products assigned to this bike yet.</p>
                  ) : (
                    <div className="space-y-px bg-slate-100 border-t border-slate-200">
                      {group.services.map((js) => {
                        const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
                        const qty = js.quantity || 1;
                        const lineTotal = price * qty;
                        const isExpanded = expandedServiceIds.has(js.id);
                        const isSystemLine = Boolean(js.service?.isSystem);
                        const qtyBusy = updatingServiceQty === js.id;
                        return (
                          <div
                            key={`service-${js.id}`}
                            className="bg-white overflow-hidden"
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
                                <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                                  Service
                                </span>
                                <p className="font-medium text-slate-900 min-w-0 truncate">
                                  {js.service?.name ?? js.customServiceName ?? "Unknown service"}
                                  {qty > 1 && (
                                    <span className="text-slate-500 font-normal"> × {qty}</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {!isSystemLine && (
                                  <div className="flex items-center rounded-md border border-slate-200 bg-white">
                                    <button
                                      type="button"
                                      aria-label="Decrease quantity"
                                      disabled={qty <= 1 || qtyBusy}
                                      onClick={() => adjustServiceQuantity(js.id, qty - 1)}
                                      className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent rounded-l-md text-sm leading-none"
                                    >
                                      −
                                    </button>
                                    <span className="min-w-[1.75rem] text-center text-sm tabular-nums text-slate-800 px-0.5">
                                      {qtyBusy ? "…" : qty}
                                    </span>
                                    <button
                                      type="button"
                                      aria-label="Increase quantity"
                                      disabled={qtyBusy}
                                      onClick={() => adjustServiceQuantity(js.id, qty + 1)}
                                      className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent rounded-r-md text-sm leading-none"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
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
                                    <div className="flex justify-between items-center gap-4">
                                      <dt className="shrink-0">Unit price</dt>
                                      <dd className="min-w-0 flex justify-end">
                                        {isSystemLine ? (
                                          <Price amount={price} variant="inline" />
                                        ) : (
                                          <input
                                            key={`unit-${js.id}-${price}`}
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            disabled={updatingServicePrice === js.id}
                                            defaultValue={Number.isFinite(price) ? String(price) : "0"}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => {
                                              const raw = e.target.value.trim();
                                              const next = parseFloat(raw);
                                              if (!Number.isFinite(next) || next < 0) return;
                                              const rounded = Math.round(next * 100) / 100;
                                              const current = Math.round(price * 100) / 100;
                                              if (rounded === current) return;
                                              void updateServiceUnitPrice(js.id, rounded);
                                            }}
                                            className="w-28 max-w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 disabled:opacity-50"
                                            aria-label="Unit price"
                                          />
                                        )}
                                      </dd>
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
                                  {isMultiBike && (
                                    <div className="mt-3 pt-2 border-t border-slate-100">
                                      <p className="text-xs text-slate-500 mb-1.5">Reassign bike</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        <button
                                          type="button"
                                          disabled={updatingServiceBike === js.id}
                                          onClick={() => applyServiceToAllBikes(js.id)}
                                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                            !js.jobBikeId
                                              ? "bg-slate-700 text-white border-slate-700"
                                              : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                                          }`}
                                        >
                                          All bikes
                                        </button>
                                        {(job.jobBikes ?? []).map((b) => {
                                          const dp = getDisplayPartsForJobBikeRow(job, b);
                                          const label = dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ");
                                          const isSelected = js.jobBikeId === b.id;
                                          return (
                                            <button
                                              key={b.id}
                                              type="button"
                                              disabled={updatingServiceBike === js.id}
                                              onClick={() => assignServiceBike(js.id, isSelected ? null : b.id)}
                                              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                                isSelected
                                                  ? "bg-violet-600 text-white border-violet-600"
                                                  : "bg-white text-slate-600 border-slate-200 hover:border-violet-400"
                                              }`}
                                            >
                                              {label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {group.products.map((jp) => {
                        const price = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
                        const lineTotal = price * (jp.quantity || 1);
                        const isExpanded = expandedProductIds.has(jp.id);
                        return (
                          <div
                            key={`product-${jp.id}`}
                            className="bg-white overflow-hidden"
                          >
                            <div
                              className="flex justify-between items-center py-2 px-3 group cursor-pointer hover:bg-slate-50"
                              onClick={() => toggleProductExpanded(jp.id)}
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
                                <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                                  Product
                                </span>
                                <p className="font-medium text-slate-900 min-w-0 truncate">
                                  {jp.product?.name ?? "Unknown product"}
                                  {jp.quantity > 1 && (
                                    <span className="text-slate-500 font-normal"> × {jp.quantity}</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <Price amount={lineTotal} variant="inline" />
                                <button
                                  onClick={() => handleRemoveProduct(jp.id)}
                                  disabled={removingProduct === jp.id}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  aria-label="Remove product"
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
                                  {jp.product?.description && (
                                    <p className="text-xs text-slate-600 mt-2 whitespace-pre-line">{jp.product.description}</p>
                                  )}
                                  <dl className="mt-2 text-xs text-slate-500 space-y-1">
                                    <div className="flex justify-between items-center gap-4">
                                      <dt className="shrink-0">Unit price</dt>
                                      <dd className="min-w-0 flex justify-end">
                                        <input
                                          key={`unit-${jp.id}-${price}`}
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          disabled={updatingProductPrice === jp.id}
                                          defaultValue={Number.isFinite(price) ? String(price) : "0"}
                                          onClick={(e) => e.stopPropagation()}
                                          onBlur={(e) => {
                                            const raw = e.target.value.trim();
                                            const next = parseFloat(raw);
                                            if (!Number.isFinite(next) || next < 0) return;
                                            const rounded = Math.round(next * 100) / 100;
                                            const current = Math.round(price * 100) / 100;
                                            if (rounded === current) return;
                                            void updateProductUnitPrice(jp.id, rounded);
                                          }}
                                          className="w-28 max-w-full rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 disabled:opacity-50"
                                          aria-label="Unit price"
                                        />
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <dt>Quantity</dt>
                                      <dd>{jp.quantity}</dd>
                                    </div>
                                    {jp.notes && (
                                      <div>
                                        <dt className="text-slate-500">Notes</dt>
                                        <dd className="text-slate-600 mt-0.5">{jp.notes}</dd>
                                      </div>
                                    )}
                                  </dl>
                                  {isMultiBike && (
                                    <div className="mt-3 pt-2 border-t border-slate-100">
                                      <p className="text-xs text-slate-500 mb-1.5">Reassign bike</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        <button
                                          type="button"
                                          disabled={updatingProductBike === jp.id}
                                          onClick={() => assignProductBike(jp.id, null)}
                                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                            !jp.jobBikeId
                                              ? "bg-slate-700 text-white border-slate-700"
                                              : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                                          }`}
                                        >
                                          All bikes
                                        </button>
                                        {(job.jobBikes ?? []).map((b) => {
                                          const dp = getDisplayPartsForJobBikeRow(job, b);
                                          const label = dp.nickname?.trim() || [dp.make, dp.model].filter(Boolean).join(" ");
                                          const isSelected = jp.jobBikeId === b.id;
                                          return (
                                            <button
                                              key={b.id}
                                              type="button"
                                              disabled={updatingProductBike === jp.id}
                                              onClick={() => assignProductBike(jp.id, isSelected ? null : b.id)}
                                              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                                isSelected
                                                  ? "bg-sky-600 text-white border-sky-600"
                                                  : "bg-white text-slate-600 border-slate-200 hover:border-sky-400"
                                              }`}
                                            >
                                              {label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-1 pb-1 border-t border-slate-100">
          <div ref={servicesDropdownRef} className="relative flex-1 min-w-[140px] max-w-sm">
            <button
              type="button"
              onClick={() => {
                setProductsDropdownOpen(false);
                setProductSearch("");
                setServicesDropdownOpen((o) => {
                  if (o) setServiceSearch("");
                  return !o;
                });
              }}
              disabled={adding}
              className="w-full text-left text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 truncate disabled:opacity-50"
            >
              {adding ? "Adding…" : "+ Add service"}
            </button>
            {servicesDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-[80] flex flex-col">
                <div className="p-2 border-b border-slate-100">
                  <input
                    ref={serviceSearchRef}
                    type="text"
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" || e.key === "Enter") {
                        const trimmed = serviceSearch.trim();
                        if (trimmed && filteredServices.length === 0) {
                          e.preventDefault();
                          void handleAddCustomService(trimmed);
                        }
                      }
                    }}
                    placeholder="Search or type a custom service…"
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleAddService(s.id)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 last:rounded-b-lg flex flex-col items-start min-w-0"
                    >
                      <span className="font-medium truncate w-full">{s.name}</span>
                      <span className="text-slate-500 text-xs">
                        ${Number(s.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </button>
                  ))}
                  {serviceSearch.trim() && filteredServices.length === 0 && (
                    <button
                      type="button"
                      onClick={() => void handleAddCustomService(serviceSearch)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-violet-50 last:rounded-b-lg flex items-center gap-2 min-w-0 text-violet-700"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="truncate">Add &ldquo;{serviceSearch.trim()}&rdquo; as custom service</span>
                    </button>
                  )}
                  {!serviceSearch.trim() && filteredServices.length === 0 && (
                    <p className="px-3 py-2 text-sm text-slate-400">No available services. Type a name to add a custom one.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div ref={productsDropdownRef} className="relative flex-1 min-w-[140px] max-w-sm">
            <button
              type="button"
              onClick={() => {
                void loadProducts();
                setServicesDropdownOpen(false);
                setServiceSearch("");
                setProductsDropdownOpen((o) => {
                  if (o) setProductSearch("");
                  return !o;
                });
              }}
              disabled={addingProduct}
              className="w-full text-left text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 truncate disabled:opacity-50"
            >
              {addingProduct ? "Adding…" : "+ Add product"}
            </button>
            {productsDropdownOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 flex flex-col">
                <div className="p-2 border-b border-slate-100 order-last">
                  <input
                    ref={productSearchRef}
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search products…"
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {productsLoading && products.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">Loading products…</p>
                  ) : filteredProducts.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">No matching products</p>
                  ) : (
                    filteredProducts.map((p) => {
                      const isAttached = attachedProductIds.has(p.id);
                      const canAddProduct = isMultiBike || !isAttached;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (canAddProduct) handleAddProduct(p.id);
                          }}
                          disabled={!canAddProduct || addingProduct}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:hover:bg-white disabled:cursor-not-allowed last:rounded-b-lg flex flex-col items-start min-w-0"
                        >
                          <span className={`font-medium truncate w-full ${!canAddProduct ? "text-slate-400" : "text-slate-900"}`}>
                            {p.name}
                          </span>
                          <span className="text-slate-500 text-xs">
                            ${Number(p.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {!canAddProduct ? " · Already added" : isAttached ? " · Add another" : ""}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-slate-200">
        <span className="font-bold text-slate-900">Total</span>
        <Price amount={total} variant="total" />
      </div>
      <div className="mt-2 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-slate-600">Paid</span>
          <Price amount={paidTowardTotal} variant="inline" />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 mt-2 border-t border-slate-200">
          <span className="font-semibold text-slate-900">Remaining</span>
          <Price
            amount={remaining}
            variant="inline"
            className={remaining > 0 ? "text-amber-700 font-bold" : ""}
          />
        </div>
      </div>
      {paymentSummary.isPaidInFull ? (
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
              {paymentSummary.totalPaid > 0 ? "Pay remaining balance" : "Pay online"}
            </a>
            <a
              href={`/pay/${job.id}?mode=in_person`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Collect in person
            </a>
            <RecordCashButton jobId={job.id} onRecorded={onJobUpdated} total={remaining} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CopyPaymentLinkButton jobId={job.id} />
            <ReprocessStripeButton jobId={job.id} onReprocessed={onJobUpdated} />
          </div>
        </div>
      )}
    </div>
  );
}
