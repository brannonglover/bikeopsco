"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import type { Job, JobBike, JobProduct, JobService, Stage } from "@/lib/types";
import { Price } from "@/components/ui/Price";
import { BikePlaceholderIcon } from "@/components/ui/BikePlaceholderIcon";
import { resolveEffectiveBikeType } from "@/lib/bike-type";
import {
  formatBikeTypeDisplayLineForJob,
  getDisplayPartsForJobBikeRow,
  getJobBikeDisplayTitle,
} from "@/lib/job-display";
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
    sender: "STAFF" | "CUSTOMER";
    createdAt: string;
    attachmentCount: number;
  } | null;
};

function CustomerChatSection({ customerId }: { customerId: string }) {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [conversation, setConversation] = useState<CustomerChatPreviewPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/conversations/by-customer/${encodeURIComponent(customerId)}`)
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
  }, [customerId]);

  const chatHref = `/chat?customer=${encodeURIComponent(customerId)}`;

  const lastMessageLine = (msg: NonNullable<CustomerChatPreviewPayload["lastMessage"]>) => {
    const text = msg.body?.trim();
    const hasAtt = msg.attachmentCount > 0;
    const prefix = msg.sender === "STAFF" ? "You: " : "";
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

function resolveBikeImageUrl(b: JobBike, customerBikes?: { make: string; model: string; imageUrl: string | null }[]): string | null {
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
  model: string;
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
      if (nextId && shouldLeaveWaitingOnPartsColumn(job, nextId)) {
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
          const displayName = dp.nickname?.trim() ? dp.nickname : `${dp.make} ${dp.model}`;
          const subtitle = dp.nickname?.trim() ? `${dp.make} ${dp.model}` : null;
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
                <img
                  src={imageUrl}
                  alt={displayName}
                  className={`${size} flex-shrink-0 object-cover rounded-lg border border-slate-100`}
                />
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
    </div>
  );
}

function JobBikesInvoiceSection({ job }: { job: Job }) {
  const jobBikes: JobBike[] = job.jobBikes ?? [];
  const hasMultiple = jobBikes.length > 1;
  const bikes = hasMultiple || jobBikes.length === 1
    ? jobBikes
    : [{ id: "legacy", make: job.bikeMake, model: job.bikeModel, nickname: null, imageUrl: null, bikeId: null, sortOrder: 0, bikeType: null } as JobBike];
  const customerBikes = job.customer?.bikes;

  return (
    <div className="mb-6 pb-4 border-b border-slate-200">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Bikes in this job
      </h3>
      <div className={`flex flex-wrap gap-2 ${hasMultiple ? "" : ""}`}>
        {bikes.map((b) => {
          const dp = getDisplayPartsForJobBikeRow(job, b);
          const imageUrl =
            dp.imageUrl ?? resolveBikeImageUrl({ ...b, make: dp.make, model: dp.model }, customerBikes);
          const eff = resolveEffectiveBikeType({
            bikeType: b.bikeType,
            make: dp.make,
            model: dp.model,
            bikeId: b.bikeId,
            bike: b.bike,
          });
          return (
          <div
            key={b.id}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" />
            ) : (
              <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center">
                <BikePlaceholderIcon className="w-5 h-5 text-slate-500" />
              </div>
            )}
            <span className="font-medium text-slate-900">
              {dp.nickname?.trim() ? dp.nickname : `${dp.make} ${dp.model}`}
            </span>
            {dp.nickname?.trim() && (
              <span className="text-slate-500">({dp.make} {dp.model})</span>
            )}
            <span className="text-xs text-slate-500 border-l border-slate-200 pl-2 ml-1">
              {eff === "E_BIKE" ? "E-bike" : "Standard"}
            </span>
          </div>
        );
        })}
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending approval",
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
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
}: {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}) {
  const [dropOff, setDropOff] = useState(() => toDateTimeLocalValue(job.dropOffDate));
  const [pickup, setPickup] = useState(() => toDateTimeLocalValue(job.pickupDate));
  const [savingField, setSavingField] = useState<"dropOffDate" | "pickupDate" | null>(null);

  useEffect(() => {
    setDropOff(toDateTimeLocalValue(job.dropOffDate));
    setPickup(toDateTimeLocalValue(job.pickupDate));
  }, [job.id, job.dropOffDate, job.pickupDate]);

  const isCollection = job.deliveryType === "COLLECTION_SERVICE";
  const firstLabel = isCollection ? "Collection date" : "Drop-off";
  const secondLabel = isCollection ? "Pickup / return" : "Pickup";

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
      }
    } finally {
      setSavingField(null);
    }
  };

  if (!onJobUpdated) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</h3>
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="text-slate-500 inline">{firstLabel}:</dt>{" "}
            <dd className="inline text-slate-900">{formatDate(job.dropOffDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 inline">{secondLabel}:</dt>{" "}
            <dd className="inline text-slate-900">{formatDate(job.pickupDate)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</h3>
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
    </div>
  );
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
                  {formatted} will be marked as paid. The job will be completed.
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

export function JobDetailModal({ job: jobProp, isOpen, onClose, onJobUpdated, onJobDeleted }: JobDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonOther, setCancelReasonOther] = useState("");
  const [job, setJob] = useState<Job | null>(jobProp);
  const latestJobPropRef = useRef(jobProp);
  latestJobPropRef.current = jobProp;

  // Mirror parent job when it changes (e.g. kanban drag PATCH updates selectedJob — same id, new object)
  useEffect(() => {
    setJob(jobProp);
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

  useEffect(() => {
    if (job) {
      setActiveTab("details");
      setShowCancelReason(false);
      setShowDeleteConfirm(false);
      setCancelReason("");
      setCancelReasonOther("");
    }
    // Only when switching jobs — same-id refreshes (invoice lines, refetch) must not reset tab or overlays.
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
      onClick={onClose}
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
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate pr-2">
            {getJobBikeDisplayTitle(job)}
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
            <InvoiceTab
              job={job}
              onJobUpdated={(updated) => {
                setJob(updated);
                onJobUpdated?.(updated);
              }}
            />
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
            {job.paymentStatus === "PAID" && (
              <span className="text-xs font-medium px-2 py-1 rounded bg-emerald-100 text-emerald-800">
                Paid
              </span>
            )}
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
                  className="text-sm text-emerald-600 hover:text-emerald-800"
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
                    className="py-2 px-3 rounded-lg bg-slate-50 border border-slate-100 text-sm"
                  >
                    <span className="font-medium text-slate-900">
                      {js.service?.name ?? "Unknown"}
                      {js.quantity > 1 && (
                        <span className="text-slate-500 font-normal"> × {js.quantity}</span>
                      )}
                    </span>
                  </div>
                ))}
                {(job.jobProducts ?? []).map((jp) => (
                  <div
                    key={jp.id}
                    className="py-2 px-3 rounded-lg bg-slate-50 border border-slate-100 text-sm"
                  >
                    <span className="font-medium text-slate-900">
                      {jp.product?.name ?? "Unknown"}
                      {jp.quantity > 1 && (
                        <span className="text-slate-500 font-normal"> × {jp.quantity}</span>
                      )}
                    </span>
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

          {job.customer && <CustomerChatSection customerId={job.customer.id} />}
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
  const [adding, setAdding] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingProduct, setRemovingProduct] = useState<string | null>(null);
  const [updatingServiceQty, setUpdatingServiceQty] = useState<string | null>(null);
  const [updatingServicePrice, setUpdatingServicePrice] = useState<string | null>(null);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const [productsDropdownOpen, setProductsDropdownOpen] = useState(false);
  const [expandedServiceIds, setExpandedServiceIds] = useState<Set<string>>(new Set());
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const servicesDropdownRef = useRef<HTMLDivElement>(null);
  const productsDropdownRef = useRef<HTMLDivElement>(null);

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
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) =>
        setProducts(
          (Array.isArray(data) ? data : []).map((p: { id: string; name: string; price: unknown }) => ({
            id: p.id,
            name: p.name,
            price: typeof p.price === "string" ? parseFloat(p.price) : Number(p.price ?? 0),
          }))
        )
      );
  }, []);

  const jobServices: JobService[] = job.jobServices ?? [];
  const jobProductsList: JobProduct[] = job.jobProducts ?? [];
  const attachedServiceIds = new Set(jobServices.map((js) => js.serviceId));
  const attachedProductIds = new Set(jobProductsList.map((jp) => jp.productId));
  const availableServices = services.filter((s) => !attachedServiceIds.has(s.id));
  const availableProducts = products.filter((p) => !attachedProductIds.has(p.id));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (servicesDropdownRef.current && !servicesDropdownRef.current.contains(e.target as Node)) {
        setServicesDropdownOpen(false);
      }
      if (productsDropdownRef.current && !productsDropdownRef.current.contains(e.target as Node)) {
        setProductsDropdownOpen(false);
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

  const handleAddProduct = async (productId: string) => {
    setAddingProduct(true);
    setProductsDropdownOpen(false);
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

  const hasLineItems = jobServices.length > 0 || jobProductsList.length > 0;
  const canAddAnything = availableServices.length > 0 || availableProducts.length > 0;

  return (
    <div>
      <JobBikesInvoiceSection job={job} />
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Line items
      </h3>
      {!hasLineItems ? (
        <p className="text-slate-500 mb-3">
          {canAddAnything
            ? "No services or products on this job yet. Add line items below."
            : "No line items yet. Add services in Settings → Services and products in Settings → Products, then use the buttons below."}
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {jobServices.map((js) => {
            const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
            const qty = js.quantity || 1;
            const lineTotal = price * qty;
            const isExpanded = expandedServiceIds.has(js.id);
            const isSystemLine = Boolean(js.service?.isSystem);
            const qtyBusy = updatingServiceQty === js.id;
            return (
              <div
                key={`service-${js.id}`}
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
                    <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                      Service
                    </span>
                    <p className="font-medium text-slate-900 min-w-0">
                      {js.service?.name ?? "Unknown service"}
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
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {jobProductsList.map((jp) => {
            const price = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
            const lineTotal = price * (jp.quantity || 1);
            const isExpanded = expandedProductIds.has(jp.id);
            return (
              <div
                key={`product-${jp.id}`}
                className="border border-slate-200 rounded-lg overflow-hidden"
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
                    <p className="font-medium text-slate-900 min-w-0">
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
                        <div className="flex justify-between gap-4">
                          <dt>Unit price</dt>
                          <dd><Price amount={price} variant="inline" /></dd>
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
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(availableServices.length > 0 || availableProducts.length > 0) && (
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-1 pb-1 border-t border-slate-100">
          {availableServices.length > 0 && (
            <div ref={servicesDropdownRef} className="relative flex-1 min-w-[140px] max-w-sm">
              <button
                type="button"
                onClick={() => {
                  setProductsDropdownOpen(false);
                  setServicesDropdownOpen((o) => !o);
                }}
                disabled={adding}
                className="w-full text-left text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 truncate disabled:opacity-50"
              >
                {adding ? "Adding…" : "+ Add service"}
              </button>
              {servicesDropdownOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
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
          {availableProducts.length > 0 && (
            <div ref={productsDropdownRef} className="relative flex-1 min-w-[140px] max-w-sm">
              <button
                type="button"
                onClick={() => {
                  setServicesDropdownOpen(false);
                  setProductsDropdownOpen((o) => !o);
                }}
                disabled={addingProduct}
                className="w-full text-left text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 truncate disabled:opacity-50"
              >
                {addingProduct ? "Adding…" : "+ Add product"}
              </button>
              {productsDropdownOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                  {availableProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddProduct(p.id)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg flex flex-col items-start min-w-0"
                    >
                      <span className="font-medium truncate w-full">{p.name}</span>
                      <span className="text-slate-500 text-xs">
                        ${Number(p.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
            <RecordCashButton jobId={job.id} onRecorded={onJobUpdated} total={total} />
          </div>
          <CopyPaymentLinkButton jobId={job.id} />
        </div>
      )}
    </div>
  );
}
