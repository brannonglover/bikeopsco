"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Preferences = {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  emailUpdatesConsent: boolean;
  smsConsent: boolean;
};

export function NotificationPreferencesPanel({
  endpoint,
  backHref,
  backLabel,
}: {
  endpoint: string;
  backHref?: string;
  backLabel?: string;
}) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [emailUpdatesConsent, setEmailUpdatesConsent] = useState(true);
  const [smsConsent, setSmsConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(endpoint, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Could not load preferences.");
        return data as Preferences;
      })
      .then((data) => {
        if (cancelled) return;
        setPreferences(data);
        setEmailUpdatesConsent(Boolean(data.emailUpdatesConsent));
        setSmsConsent(Boolean(data.smsConsent));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load preferences.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function savePreferences() {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailUpdatesConsent, smsConsent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not save preferences.");
        return;
      }
      setPreferences((prev) =>
        prev
          ? {
              ...prev,
              emailUpdatesConsent: Boolean(data.emailUpdatesConsent),
              smsConsent: Boolean(data.smsConsent),
            }
          : prev
      );
      setEmailUpdatesConsent(Boolean(data.emailUpdatesConsent));
      setSmsConsent(Boolean(data.smsConsent));
      setNotice("Your notification settings have been saved.");
    } catch {
      setError("Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
        <p className="text-slate-500">Loading settings...</p>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="font-medium text-red-600">{error ?? "Could not load preferences."}</p>
      </div>
    );
  }

  const name = [preferences.firstName, preferences.lastName].filter(Boolean).join(" ");
  const isUnchanged =
    emailUpdatesConsent === preferences.emailUpdatesConsent &&
    smsConsent === preferences.smsConsent;

  return (
    <div className="w-full max-w-md space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-900">Notification settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          {name || "Choose how the shop should contact you."}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-900">
            Status updates and chat messages
          </legend>
          <p className="text-sm text-slate-600">
            Choose at least one way to receive repair updates and chat message notifications.
          </p>

          <label className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 ${preferences.email ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-100 opacity-60"}`}>
            <input
              type="checkbox"
              checked={emailUpdatesConsent}
              disabled={!preferences.email}
              onChange={(e) => {
                setEmailUpdatesConsent(e.target.checked);
                setError(null);
                setNotice(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-amber-600 focus:ring-amber-500/20"
            />
            <span className="min-w-0 text-sm leading-snug text-slate-700">
              <span className="block font-medium text-slate-900">Email</span>
              <span className="block truncate">{preferences.email || "No email address on file"}</span>
            </span>
          </label>

          <label className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 ${preferences.phone ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-100 opacity-60"}`}>
            <input
              type="checkbox"
              checked={smsConsent}
              disabled={!preferences.phone}
              onChange={(e) => {
                setSmsConsent(e.target.checked);
                setError(null);
                setNotice(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-amber-600 focus:ring-amber-500/20"
            />
            <span className="min-w-0 text-sm leading-snug text-slate-700">
              <span className="block font-medium text-slate-900">SMS</span>
              <span className="block truncate">{preferences.phone || "No phone number on file"}</span>
              <span className="mt-1 block text-xs text-slate-500">
                No marketing. Message frequency varies. Message & data rates may apply. Reply STOP to opt out.
              </span>
            </span>
          </label>
        </fieldset>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <button
          type="button"
          onClick={savePreferences}
          disabled={saving || isUnchanged}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>

      {backHref && (
        <Link href={backHref} className="block text-center text-sm font-medium text-slate-600 hover:text-slate-900">
          {backLabel ?? "Back"}
        </Link>
      )}
    </div>
  );
}
