"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";

type BillingStatus = {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
  billingActive: boolean;
  monthlyPrice: number;
};

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"checkout" | "portal" | null>(null);

  const trialDaysLeft = useMemo(() => {
    if (!billing?.trialEndsAt) return null;
    const days = Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / 86400000);
    return Math.max(0, days);
  }, [billing?.trialEndsAt]);

  async function loadBilling() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Could not load billing.");
      setBilling(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing.");
    } finally {
      setLoading(false);
    }
  }

  async function redirectFrom(endpoint: "/api/billing/checkout" | "/api/billing/portal") {
    setActionLoading(endpoint.endsWith("checkout") ? "checkout" : "portal");
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Could not start billing session.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start billing session.");
      setActionLoading(null);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Billing</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Start with 14 days free. After trial, Bike Ops is ${billing?.monthlyPrice.toFixed(2) ?? "39.99"} per month.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            Loading billing...
          </div>
        ) : billing ? (
          <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
            <div>
              <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {statusLabel(billing.status)}
              </div>
              <h2 className="mt-4 text-xl font-semibold text-slate-950">
                {billing.billingActive ? "Your workspace is active" : "Payment required"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {billing.hasSubscription
                  ? billing.cancelAtPeriodEnd
                    ? `Your subscription remains available until ${formatDate(billing.currentPeriodEnd)}.`
                    : `Your next billing period ends ${formatDate(billing.currentPeriodEnd)}.`
                  : trialDaysLeft && trialDaysLeft > 0
                    ? `Your free trial ends ${formatDate(billing.trialEndsAt)}. Add payment details any time before then.`
                    : "Your free trial has ended. Add payment details to continue using staff features."}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() =>
                  redirectFrom(billing.hasSubscription ? "/api/billing/portal" : "/api/billing/checkout")
                }
                disabled={actionLoading !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" aria-hidden />
                {billing.hasSubscription ? "Manage subscription" : "Add payment details"}
              </button>
              {billing.hasStripeCustomer && (
                <button
                  type="button"
                  onClick={() => redirectFrom("/api/billing/portal")}
                  disabled={actionLoading !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Manage billing
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Trial", "14 days free for every new shop workspace."],
          ["Plan", "One flat Bike Ops subscription at $39.99 per month."],
          ["Payments", "Stripe handles cards, invoices, failed-payment recovery, and receipts."],
        ].map(([title, copy]) => (
          <div key={title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-slate-950">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
