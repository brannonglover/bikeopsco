"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Price } from "@/components/ui/Price";
import { computeJobSubtotal, getJobPaymentSummary } from "@/lib/job-payments";

const PAYABLE_STAGES = ["RECEIVED", "WORKING_ON", "WAITING_ON_CUSTOMER", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED"] as const;

function PaymentForm({
  jobId,
  total,
  customerEmail,
  inPerson,
}: {
  jobId: string;
  total: number;
  customerEmail?: string | null;
  inPerson?: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeError, setStripeError] = useState(false);

  // If PaymentElement never fires onReady, surface an error after 30 seconds.
  // Stripe Link's session lookup (consumers/sessions/lookup) can cause delays
  // on some accounts — allow_redirects:never on the intent mitigates this, but
  // keep a generous timeout as a fallback.
  useEffect(() => {
    if (stripeReady) return;
    const timeout = setTimeout(() => setStripeError(true), 30_000);
    return () => clearTimeout(timeout);
  }, [stripeReady]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/calendar?paid=${jobId}`,
        receipt_email: undefined,
      },
    });

    if (submitError) {
      setError(submitError.message ?? "Payment failed");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-4 text-xs text-slate-500">
          {inPerson ? "Enter card details below" : "Card, Apple Pay, and Google Pay accepted"}
        </p>
        <PaymentElement
          onReady={() => setStripeReady(true)}
          options={{
            layout: "tabs",
            paymentMethodOrder: inPerson ? ["card"] : ["apple_pay", "google_pay", "card"],
            wallets: inPerson
              ? { applePay: "never", googlePay: "never" }
              : { applePay: "auto", googlePay: "auto" },
            defaultValues: customerEmail ? { billingDetails: { email: customerEmail } } : undefined,
            fields: { billingDetails: { email: inPerson ? "never" : "auto" } },
          }}
        />
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {!stripeReady && !error && !stripeError && (
        <p className="text-center text-xs text-slate-400">Loading payment form…</p>
      )}
      {stripeError && !error && (
        <div className="text-center space-y-2">
          <p className="text-sm text-red-600">
            Payment form failed to load.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm text-emerald-700 underline hover:text-emerald-900"
          >
            Tap to retry
          </button>
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || !stripeReady || loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Processing…" : `Charge ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
      </button>
    </form>
  );
}

export default function PayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const jobId = params?.jobId as string;
  const inPerson = searchParams?.get("mode") === "in_person";

  const [job, setJob] = useState<{
    id: string;
    bikeMake: string;
    bikeModel: string;
    stage: string;
    customer?: { firstName: string; lastName?: string | null; email?: string | null } | null;
    jobServices: { service?: { name: string } | null; customServiceName?: string | null; quantity: number; unitPrice: string | number }[];
    jobProducts?: { product: { name: string }; quantity: number; unitPrice: string | number }[];
    paymentStatus: string;
    totalPaid?: number;
  } | null>(null);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<{
    subtotal: number;
    amount: number;
    originalSubtotal: number;
    totalPaid: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function init() {
      try {
        const jobRes = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });

        if (!jobRes.ok) {
          setError("Job not found");
          return;
        }

        const jobData = await jobRes.json();
        setJob(jobData);

        const localSubtotal = computeJobSubtotal({
          jobServices: jobData.jobServices ?? [],
          jobProducts: jobData.jobProducts ?? [],
        });
        const localPaymentSummary = getJobPaymentSummary({
          currentStatus: jobData.paymentStatus,
          subtotal: localSubtotal,
          totalPaid: typeof jobData.totalPaid === "number" ? jobData.totalPaid : 0,
        });

        if (localPaymentSummary.isPaidInFull || localPaymentSummary.remaining <= 0) {
          setPaymentAmount({
            subtotal: 0,
            amount: 0,
            originalSubtotal: localSubtotal,
            totalPaid: localPaymentSummary.totalPaid,
          });
          return;
        }

        if (!inPerson && !PAYABLE_STAGES.includes(jobData.stage)) {
          setError("Payment is not available until the shop has confirmed your booking and received your bike.");
          return;
        }

        if (localSubtotal <= 0) {
          setError("No services or products to pay for");
          return;
        }

        const intentRes = await fetch(`/api/jobs/${jobId}/payments/create-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: inPerson ? "in_person" : "online" }),
        });

        if (!intentRes.ok) {
          const errData = await intentRes.json().catch(() => ({}));
          setError(errData.error ?? "Failed to initialize payment");
          return;
        }

        const {
          clientSecret: secret,
          publishableKey,
          amount,
          subtotal: intentSubtotal,
          originalSubtotal,
          totalPaid,
        } = await intentRes.json();
        setStripePromise(loadStripe(publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!));
        setClientSecret(secret);
        setPaymentAmount({
          subtotal: intentSubtotal ?? localPaymentSummary.remaining,
          amount: amount ?? localPaymentSummary.remaining,
          originalSubtotal: originalSubtotal ?? localSubtotal,
          totalPaid: totalPaid ?? localPaymentSummary.totalPaid,
        });
      } catch {
        setError("Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [jobId, inPerson]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
        <p className="text-slate-500">Loading payment…</p>
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

  const originalSubtotal =
    paymentAmount?.originalSubtotal ??
    computeJobSubtotal({
      jobServices: job.jobServices ?? [],
      jobProducts: job.jobProducts ?? [],
    });
  const totalPaid = paymentAmount?.totalPaid ?? (typeof job.totalPaid === "number" ? job.totalPaid : 0);
  const paymentSummary = getJobPaymentSummary({
    currentStatus: job.paymentStatus,
    subtotal: originalSubtotal,
    totalPaid,
  });
  const subtotal = paymentAmount?.subtotal ?? paymentSummary.remaining;
  const total = paymentAmount?.amount ?? subtotal;
  const hasSurcharge = total > subtotal;
  const hasPartialPayment = totalPaid > 0 && subtotal > 0;
  const isPaidInFull = paymentSummary.isPaidInFull || subtotal <= 0;
  const displayedTotal = isPaidInFull ? originalSubtotal : total;
  const lineItems = [
    ...(job.jobServices ?? []).map((item) => ({
      name: item.service?.name ?? item.customServiceName ?? "Service",
      quantity: item.quantity || 1,
      unitPrice: Number(item.unitPrice),
      kind: "Service",
    })),
    ...(job.jobProducts ?? []).map((item) => ({
      name: item.product?.name ?? "Product",
      quantity: item.quantity || 1,
      unitPrice: Number(item.unitPrice),
      kind: "Product",
    })),
  ];

  const customerName = job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ")
    : null;

  const hasReceiptEmail = !!(job.customer?.email?.trim());

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-900">
          {inPerson ? "Collect payment" : "Complete your payment"}
        </h1>
        <p className="mt-1 text-slate-500">
          {job.bikeMake} {job.bikeModel}
          {customerName && ` · ${customerName}`}
        </p>
        <div className="mt-2">
          {hasPartialPayment ? (
            <div className="space-y-0.5 text-sm">
              <p className="text-slate-600">
                Original total <Price amount={originalSubtotal} variant="inline" />
              </p>
              <p className="text-emerald-700">
                Already paid <Price amount={totalPaid} variant="inline" />
              </p>
              <p className="text-slate-700 font-medium">
                Remaining balance <Price amount={subtotal} variant="inline" />
              </p>
              {!inPerson && hasSurcharge && (
                <p className="text-slate-500 text-xs">
                  Card processing fee{" "}
                  <span className="font-medium tabular-nums text-slate-600">
                    {(total - subtotal).toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </p>
              )}
              <p>
                <Price amount={total} variant="total" />
              </p>
            </div>
          ) : !inPerson && hasSurcharge ? (
            <div className="space-y-0.5 text-sm">
              <p className="text-slate-600">
                Subtotal <Price amount={subtotal} variant="inline" />
              </p>
              <p className="text-slate-500 text-xs">
                Card processing fee{" "}
                <span className="font-medium tabular-nums text-slate-600">
                  {(total - subtotal).toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 2,
                  })}
                </span>
              </p>
              <p>
                <Price amount={total} variant="total" />
              </p>
            </div>
          ) : (
            <Price amount={displayedTotal} variant="total" />
          )}
        </div>
        {!inPerson && (
          hasReceiptEmail ? (
            <p className="mt-3 text-sm text-emerald-600">
              Receipt will be sent to {job.customer!.email}
            </p>
          ) : (
            <p className="mt-3 text-sm text-amber-600">
              Link a customer with an email to this job to receive a receipt, or enter your email when paying by card.
            </p>
          )
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Itemized bill</h2>
          <span className="text-sm font-semibold tabular-nums text-slate-700">
            {originalSubtotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {lineItems.length > 0 ? (
            lineItems.map((item, index) => {
              const lineTotal = item.unitPrice * item.quantity;
              return (
                <div key={`${item.kind}-${item.name}-${index}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.kind} · Qty {item.quantity} ·{" "}
                      {item.unitPrice.toLocaleString("en-US", { style: "currency", currency: "USD" })} each
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                    {lineTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                  </p>
                </div>
              );
            })
          ) : (
            <p className="py-2 text-sm text-slate-500">No services or products have been added yet.</p>
          )}
        </div>
      </div>

      {clientSecret && stripePromise ? (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "stripe",
              variables: { borderRadius: "8px" },
            },
          }}
        >
          <PaymentForm jobId={jobId} total={total} customerEmail={job.customer?.email} inPerson={inPerson} />
        </Elements>
      ) : isPaidInFull ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm font-medium text-emerald-800">
          This bill is paid in full.
        </div>
      ) : null}
    </div>
  );
}
