"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Price } from "@/components/ui/Price";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function PaymentForm({
  jobId,
  total,
  customerEmail,
}: {
  jobId: string;
  total: number;
  customerEmail?: string | null;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className=" rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-4 text-xs text-slate-500">Card, Apple Pay, and Google Pay accepted</p>
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["apple_pay", "google_pay", "card"],
            wallets: {
              applePay: "auto",
              googlePay: "auto",
            },
            defaultValues: customerEmail ? { billingDetails: { email: customerEmail } } : undefined,
            fields: { billingDetails: { email: "auto" } },
          }}
        />
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Processing…" : `Pay ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
      </button>
    </form>
  );
}

export default function PayPage() {
  const params = useParams();
  const jobId = params?.jobId as string;
  const [job, setJob] = useState<{
    id: string;
    bikeMake: string;
    bikeModel: string;
    customer?: { firstName: string; lastName?: string | null; email?: string | null } | null;
    jobServices: { service?: { name: string } | null; customServiceName?: string | null; quantity: number; unitPrice: string | number }[];
    jobProducts?: { product: { name: string }; quantity: number; unitPrice: string | number }[];
    paymentStatus: string;
  } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<{
    subtotal: number;
    amount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function init() {
      try {
        const [jobRes, intentRes] = await Promise.all([
          fetch(`/api/jobs/${jobId}`),
          fetch(`/api/jobs/${jobId}/payments/create-intent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "online" }),
          }),
        ]);

        if (!jobRes.ok) {
          setError("Job not found");
          return;
        }

        const jobData = await jobRes.json();
        setJob(jobData);

        if (jobData.paymentStatus === "PAID") {
          setError("This job is already paid");
          return;
        }

        const lineTotal = (js: { unitPrice: string | number; quantity: number }) => {
          const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
          return price * (js.quantity || 1);
        };
        const subtotal =
          (jobData.jobServices ?? []).reduce((sum: number, js: { unitPrice: string | number; quantity: number }) => sum + lineTotal(js), 0) +
          (jobData.jobProducts ?? []).reduce((sum: number, jp: { unitPrice: string | number; quantity: number }) => sum + lineTotal(jp), 0);

        if (subtotal <= 0) {
          setError("No services or products to pay for");
          return;
        }

        if (!intentRes.ok) {
          const errData = await intentRes.json().catch(() => ({}));
          setError(errData.error ?? "Failed to initialize payment");
          return;
        }

        const { clientSecret: secret, amount, subtotal: intentSubtotal } = await intentRes.json();
        setClientSecret(secret);
        setPaymentAmount({
          subtotal: intentSubtotal ?? subtotal,
          amount: amount ?? subtotal,
        });
      } catch {
        setError("Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [jobId]);

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

  const lineTotal = (js: { unitPrice: string | number; quantity: number }) => {
    const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    return price * (js.quantity || 1);
  };
  const subtotal =
    paymentAmount?.subtotal ??
    ((job.jobServices ?? []).reduce((sum: number, js) => sum + lineTotal(js), 0) +
      (job.jobProducts ?? []).reduce((sum: number, jp) => sum + lineTotal(jp), 0));
  const total =
    paymentAmount?.amount ??
    ((job.jobServices ?? []).reduce((sum: number, js) => sum + lineTotal(js), 0) +
      (job.jobProducts ?? []).reduce((sum: number, jp) => sum + lineTotal(jp), 0));
  const hasSurcharge = total > subtotal;

  const customerName = job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ")
    : null;

  const hasReceiptEmail = !!(job.customer?.email?.trim());

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-900">Complete your payment</h1>
        <p className="mt-1 text-slate-500">
          {job.bikeMake} {job.bikeModel}
          {customerName && ` · ${customerName}`}
        </p>
        <div className="mt-2">
          {hasSurcharge ? (
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
            <Price amount={total} variant="total" />
          )}
        </div>
        {hasReceiptEmail ? (
          <p className="mt-3 text-sm text-emerald-600">
            Receipt will be sent to {job.customer!.email}
          </p>
        ) : (
          <p className="mt-3 text-sm text-amber-600">
            Link a customer with an email to this job to receive a receipt, or enter your email when paying by card.
          </p>
        )}
      </div>

      {clientSecret ? (
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
          <PaymentForm jobId={jobId} total={total} customerEmail={job.customer?.email} />
        </Elements>
      ) : null}
    </div>
  );
}
