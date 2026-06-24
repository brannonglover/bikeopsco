"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type VerifyState =
  | { status: "loading" }
  | { status: "success"; loginUrl: string; shopName: string }
  | { status: "error"; code: string };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "This verification link is invalid or has already been used.",
  expired: "This verification link has expired. Please sign up again to receive a new email.",
  subdomain_taken: "That subdomain was claimed while you were verifying. Please sign up again with a different subdomain.",
};

export default function SignupVerifyPage() {
  const [state, setState] = useState<VerifyState>({ status: "loading" });

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get("token");

    if (!token) {
      setState({ status: "error", code: "invalid" });
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const response = await fetch("/api/signup", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setState({ status: "error", code: data?.error ?? "invalid" });
          return;
        }

        setState({
          status: "success",
          loginUrl: data.loginUrl,
          shopName: data.shop?.name ?? "your shop",
        });
      } catch {
        if (!cancelled) {
          setState({ status: "error", code: "invalid" });
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen w-full bg-mesh px-4 py-10 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col items-center justify-center">
        <Link href="/signup" className="mb-8 inline-flex w-full max-w-xs">
          <Image
            src="/bike-ops-logo.png"
            alt="Bike Ops"
            width={640}
            height={320}
            className="h-auto w-full"
            priority
          />
        </Link>

        {state.status === "loading" && (
          <div className="w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-slate-600" aria-hidden />
            <h1 className="text-xl font-semibold">Confirming your email</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Hang tight while we finish setting up your workspace.
            </p>
          </div>
        )}

        {state.status === "success" && (
          <div className="w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden />
            <h1 className="text-2xl font-semibold">Your shop is ready</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              <strong>{state.shopName}</strong> is set up. Sign in on your new Bike Ops workspace to get started.
            </p>
            <Link
              href={state.loginUrl}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-900"
            >
              Open workspace
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <XCircle className="mx-auto mb-4 h-12 w-12 text-red-600" aria-hidden />
            <h1 className="text-2xl font-semibold">Could not verify email</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {ERROR_MESSAGES[state.code] ?? ERROR_MESSAGES.invalid}
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-900"
            >
              Back to signup
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
