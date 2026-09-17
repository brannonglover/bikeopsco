"use client";

import { useCallback, useEffect, useState } from "react";
import type { Customer } from "@/lib/types";
import {
  formatPhoneDisplay,
  formatPhoneInputUS,
  phoneToInputValue,
} from "@/lib/phone";

type Suggestion = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mentionedPhones: string[];
};

type PossibleDuplicate = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
};

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
};

const FIELD_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

/** Names the fields the thread supplied, so staff know what to double-check. */
function describeFound(suggestion: Suggestion): string | null {
  const found = [
    suggestion.firstName ? "name" : null,
    suggestion.email ? "email" : null,
    suggestion.mentionedPhones.length > 0 ? "phone number" : null,
  ].filter(Boolean) as string[];
  if (found.length === 0) return null;
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

/**
 * Fills in a contact auto-created to hold a text from an unknown number,
 * pre-filled with the name, email and any numbers found in the thread itself.
 */
export function CreateContactModal({
  conversationId,
  onClose,
  onSaved,
}: {
  conversationId: string;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [duplicate, setDuplicate] = useState<PossibleDuplicate | null>(null);
  const [initialPhone, setInitialPhone] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/conversations/${conversationId}/contact`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not read this conversation");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const found: Suggestion = data.suggestion;
        setSuggestion(found);
        setDuplicate(data.possibleDuplicate ?? null);
        const phoneValue = phoneToInputValue(data.customer.phone);
        setInitialPhone(phoneValue);
        setForm({
          // The placeholder name is the phone number itself, so it is never
          // carried into the form — only a real name found in the thread is.
          firstName: found.firstName ?? "",
          lastName: found.lastName ?? "",
          email: found.email ?? data.customer.email ?? "",
          phone: phoneValue,
          address: data.customer.address ?? "",
          notes: data.customer.notes ?? "",
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Something went wrong");
        }
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

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    []
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!form.firstName.trim()) {
      setError("First name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // An untouched phone field is left out of the payload entirely. The
      // stored number is already correct — the number they texted from — and
      // round-tripping it through the US-centric input formatting would
      // rewrite anything outside the North American numbering plan.
      const { phone, ...rest } = form;
      const body =
        phone === initialPhone ? rest : { ...rest, phone };

      const res = await fetch(`/api/conversations/${conversationId}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Could not save this contact");
      }
      onSaved(payload as Customer);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save this contact");
    } finally {
      setSaving(false);
    }
  };

  const foundLabel = suggestion ? describeFound(suggestion) : null;
  const duplicateName = duplicate
    ? [duplicate.firstName, duplicate.lastName].filter(Boolean).join(" ")
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contact-title"
      >
        <div className="border-b border-slate-200 p-4">
          <h3
            id="create-contact-title"
            className="text-lg font-semibold text-slate-900"
          >
            Create contact
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? "Reading the conversation…"
              : foundLabel
                ? `Found ${foundLabel} in this conversation — check before saving.`
                : "Nothing to go on in this conversation yet — fill in what you know."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {duplicate && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  {duplicateName || "An existing contact"} already uses{" "}
                  {duplicate.email}. If this is them, open their profile and add
                  this number there instead of creating a second contact.
                </p>
                <a
                  href={`/customers?edit=${encodeURIComponent(duplicate.id)}`}
                  className="mt-1 inline-block font-medium underline"
                >
                  Open that contact
                </a>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                First name
                <span className="text-rose-600"> *</span>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                  autoComplete="given-name"
                  required
                  disabled={loading}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Last name
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                  autoComplete="family-name"
                  disabled={loading}
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                autoComplete="email"
                disabled={loading}
                className={FIELD_CLASS}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Phone
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => update("phone", formatPhoneInputUS(e.target.value))}
                autoComplete="tel"
                disabled={loading}
                className={FIELD_CLASS}
              />
            </label>
            <p className="text-xs text-slate-500">
              Texts are sent to this number — it is the one they messaged from.
            </p>

            {suggestion?.mentionedPhones.map((phone) => (
              <button
                key={phone}
                type="button"
                onClick={() => update("phone", formatPhoneInputUS(phone))}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Also mentioned: {formatPhoneDisplay(phone)} — use this
              </button>
            ))}

            <label className="block text-sm font-medium text-slate-700">
              Address
              <input
                type="text"
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                autoComplete="street-address"
                disabled={loading}
                className={FIELD_CLASS}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Notes
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={2}
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
              disabled={saving || loading}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
