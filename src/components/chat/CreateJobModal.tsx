"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { valueOf } from "@/lib/conversation-context/field";
import type { ServiceMatch } from "@/lib/conversation-context/service-matching";
import type {
  BikeContext,
  ConversationContext,
  CustomerIdentityContext,
} from "@/lib/conversation-context/types";
import {
  buildJobDraft,
  type JobDraftBike,
} from "@/lib/job-from-conversation";

type ShopService = { id: string; name: string; price: number };
type CustomerBike = {
  id: string;
  make: string;
  model: string | null;
  bikeType: "REGULAR" | "E_BIKE" | null;
};
type ExistingJob = { id: string; stage: string; createdAt: string };

type JobContextPayload = {
  customer: { provisional: boolean };
  identity: CustomerIdentityContext;
  bikes: BikeContext[];
  service: ConversationContext["service"];
  scheduling: ConversationContext["scheduling"];
  services: ShopService[];
  customerBikes: CustomerBike[];
  existingJobs: ExistingJob[];
};

const FIELD_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-wide text-slate-500";

const EMPTY_BIKE: JobDraftBike = {
  make: "",
  model: "",
  bikeType: null,
  describedAs: null,
};

/** A list of the customer's own words, shown but never edited here. */
function QuotedList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className={SECTION_LABEL}>{label}</h4>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="text-sm text-slate-700">
            &bull; {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Reviewing a job before it exists.
 *
 * Everything here was already said in the thread; the screen's job is to show
 * it clearly enough that staff can catch what the assistant got wrong, and to
 * keep apart the three things that look alike on a job card. What the bike is
 * doing, what the customer thinks is causing it, and what they actually asked
 * for are displayed separately and travel differently: only the last can
 * become a line item, and only when the shop sells something that plainly
 * matches it.
 *
 * Nothing is written until staff press the button.
 */
export function CreateJobModal({
  conversationId,
  onClose,
  onCreated,
}: {
  conversationId: string;
  onClose: () => void;
  onCreated: (job: { id: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<JobContextPayload | null>(null);

  const [bikes, setBikes] = useState<JobDraftBike[]>([EMPTY_BIKE]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [dropOffDate, setDropOffDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/conversations/${conversationId}/job`)
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "Could not read this conversation");
        return payload as JobContextPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        // The draft is built by the shared mapping rather than here, so the
        // rules about what may become a line item hold wherever a job is
        // built from a conversation.
        const draft = buildJobDraft({
          bikes: payload.bikes,
          service: payload.service,
          scheduling: payload.scheduling,
        });
        setBikes(draft.bikes.length > 0 ? draft.bikes : [EMPTY_BIKE]);
        setServiceIds(draft.serviceIds);
        setNotes(draft.customerNotes);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleService = useCallback((id: string) => {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }, []);

  const updateBike = useCallback(
    (index: number, key: "make" | "model", value: string) =>
      setBikes((prev) =>
        prev.map((bike, i) => (i === index ? { ...bike, [key]: value } : bike))
      ),
    []
  );

  const applyCustomerBike = useCallback((index: number, bike: CustomerBike) => {
    setBikes((prev) =>
      prev.map((existing, i) =>
        i === index
          ? {
              make: bike.make,
              model: bike.model ?? "",
              bikeType: bike.bikeType,
              describedAs: existing.describedAs,
            }
          : existing
      )
    );
  }, []);

  const identityName = useMemo(() => {
    if (!data) return "";
    return [valueOf(data.identity.firstName), valueOf(data.identity.lastName)]
      .filter(Boolean)
      .join(" ");
  }, [data]);

  const symptoms = data ? (valueOf(data.service.symptoms) ?? []) : [];
  const suspicions = data ? (valueOf(data.service.customerSuspicions) ?? []) : [];
  const availability = data ? (valueOf(data.scheduling.availability) ?? []) : [];
  const matches: ServiceMatch[] = data?.service.serviceMatches ?? [];

  // Services the shop sells that no request pointed at. Offered after the
  // matched ones so staff can add the obvious thing nobody thought to say.
  const suggestedIds = new Set(
    matches.map((match) => match.serviceId).filter(Boolean) as string[]
  );
  const otherServices = (data?.services ?? []).filter(
    (service) => !suggestedIds.has(service.id)
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const filledBikes = bikes.filter((bike) => bike.make.trim().length > 0);
    if (filledBikes.length === 0) {
      setError("Add the bike's make before creating the job");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bikes: filledBikes.map((bike) => ({
            make: bike.make.trim(),
            model: bike.model.trim() || null,
            bikeType: bike.bikeType,
          })),
          serviceIds,
          customerNotes: notes.trim() || null,
          dropOffDate: dropOffDate || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "Could not create this job");
      onCreated(payload as { id: string });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create this job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white sm:max-h-[88vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-job-title"
      >
        <div className="border-b border-slate-200 p-4">
          <h3 id="create-job-title" className="text-lg font-semibold text-slate-900">
            Create job
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? "Reading the conversation…"
              : "Everything below came from this thread. Check it before it becomes a job."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {data?.customer.provisional && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This contact is still just the number they texted from. Create the
                contact first, or the job goes on the board with a phone number
                where the customer&rsquo;s name should be.
              </div>
            )}

            {data && data.existingJobs.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                A job was already created from this conversation. Creating another
                will put a second one on the board.
                <a
                  href={`/calendar?openJob=${encodeURIComponent(data.existingJobs[0].id)}`}
                  className="mt-1 block font-medium underline"
                >
                  Open the existing job
                </a>
              </div>
            )}

            {data && (
              <section>
                <h4 className={SECTION_LABEL}>Customer</h4>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {identityName || "Unnamed contact"}
                </p>
                {valueOf(data.identity.email) && (
                  <p className="text-sm text-slate-600">
                    {valueOf(data.identity.email)}
                  </p>
                )}
                {valueOf(data.identity.phone) && (
                  <p className="text-sm text-slate-600">
                    {valueOf(data.identity.phone)}
                  </p>
                )}
              </section>
            )}

            <section>
              <h4 className={SECTION_LABEL}>Bike</h4>
              {bikes.map((bike, index) => (
                <div key={index} className="mt-1 space-y-2">
                  {bike.describedAs && (
                    <p className="text-xs text-slate-500">
                      They called it &ldquo;{bike.describedAs}&rdquo;
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Make
                      <span className="text-rose-600"> *</span>
                      <input
                        type="text"
                        value={bike.make}
                        onChange={(e) => updateBike(index, "make", e.target.value)}
                        disabled={loading}
                        className={FIELD_CLASS}
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Model
                      <input
                        type="text"
                        value={bike.model}
                        onChange={(e) => updateBike(index, "model", e.target.value)}
                        disabled={loading}
                        className={FIELD_CLASS}
                      />
                    </label>
                  </div>
                  {(data?.customerBikes.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {data?.customerBikes.map((owned) => (
                        <button
                          key={owned.id}
                          type="button"
                          onClick={() => applyCustomerBike(index, owned)}
                          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          On file: {[owned.make, owned.model].filter(Boolean).join(" ")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setBikes((prev) => [...prev, EMPTY_BIKE])}
                className="mt-2 text-xs font-medium text-emerald-700 hover:underline"
              >
                + Add another bike
              </button>
            </section>

            <QuotedList label="Customer reports" items={symptoms} />
            <QuotedList label="Customer suspects" items={suspicions} />
            {suspicions.length > 0 && (
              <p className="-mt-2 text-xs text-slate-500">
                Their guess, not a diagnosis — it goes on the job as a note, never
                as work.
              </p>
            )}

            <section>
              <h4 className={SECTION_LABEL}>Requested work</h4>
              {matches.length === 0 && (
                <p className="mt-1 text-sm text-slate-500">
                  They did not ask for anything specific.
                </p>
              )}
              <div className="mt-1 space-y-1.5">
                {matches.map((match) => (
                  <div key={match.requested}>
                    {match.serviceId ? (
                      <label className="flex items-start gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={serviceIds.includes(match.serviceId)}
                          onChange={() => toggleService(match.serviceId as string)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>
                          &ldquo;{match.requested}&rdquo;
                          <span className="text-slate-500">
                            {" "}
                            &rarr; {match.serviceName}
                            {match.confidence === "weak" && " (not sure — check this)"}
                          </span>
                        </span>
                      </label>
                    ) : (
                      <p className="text-sm text-slate-700">
                        &ldquo;{match.requested}&rdquo;
                        <span className="text-slate-500">
                          {" "}
                          &rarr; nothing on the price list matches; kept in the notes
                        </span>
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {otherServices.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    Add another service
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    {otherServices.map((service) => (
                      <label
                        key={service.id}
                        className="flex items-center gap-2 text-sm text-slate-800"
                      >
                        <input
                          type="checkbox"
                          checked={serviceIds.includes(service.id)}
                          onChange={() => toggleService(service.id)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        {service.name}
                        <span className="text-slate-500">
                          ${service.price.toFixed(2)}
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </section>

            <section>
              <h4 className={SECTION_LABEL}>Availability</h4>
              {availability.length > 0 ? (
                <p className="mt-1 text-sm text-slate-700">
                  They said: {availability.map((slot) => `“${slot}”`).join(", ")}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  They did not say when they could come by.
                </p>
              )}
              <label className="mt-2 block text-sm font-medium text-slate-700">
                Drop-off date
                <input
                  type="date"
                  value={dropOffDate}
                  onChange={(e) => setDropOffDate(e.target.value)}
                  disabled={loading}
                  className={FIELD_CLASS}
                />
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Left empty unless you set one — what they said is not turned into a
                booking on its own.
              </p>
            </section>

            <label className="block text-sm font-medium text-slate-700">
              Notes on the job
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                disabled={loading}
                className={FIELD_CLASS}
              />
            </label>

            {error && (
              <p className="text-sm text-rose-600" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2 border-t border-slate-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || loading || data?.customer.provisional}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
