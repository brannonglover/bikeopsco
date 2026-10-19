"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

const LINK_ERRORS: Record<string, string> = {
  expired: "This reset link has expired. Request a new one below.",
  invalid: "This reset link is invalid or has already been used. Request a new one below.",
};

export default function ResetPasswordPage() {
  // undefined while reading the fragment, null when the URL carried no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const value = hash.get("token");
    // Functional update: a second run (React strict mode) finds the fragment
    // already stripped and must not discard the token the first run read.
    setToken((prev) => value || prev || null);
    // Keep the token out of history and anything that reads the address bar.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const reason = data.error ?? "";
        if (reason === "expired" || reason === "invalid") {
          setLinkError(LINK_ERRORS[reason]);
        } else {
          setError(reason || "Something went wrong. Please try again.");
        }
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-mesh p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-5 flex h-40 items-center justify-center sm:h-48">
          <BrandLogo width={800} height={400} className="h-40 w-auto max-w-full object-contain sm:h-48" priority />
        </div>
        <h1 className="mb-6 text-center text-xl font-semibold text-slate-900">Choose a new password</h1>
        {token === undefined ? (
          <p className="text-center text-sm text-slate-600">Loading…</p>
        ) : done ? (
          <div className="space-y-4 text-center">
            <p className="text-sm leading-6 text-slate-600" role="status">
              Your password has been changed. You can sign in with it now.
            </p>
            <Link
              href="/login"
              className="block w-full rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white hover:bg-slate-800"
            >
              Sign in
            </Link>
          </div>
        ) : linkError || token === null ? (
          <div className="space-y-4 text-center">
            <p className="text-sm leading-6 text-red-600" role="alert">
              {linkError ?? LINK_ERRORS.invalid}
            </p>
            <Link
              href="/login/forgot"
              className="block w-full rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white hover:bg-slate-800"
            >
              Send a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-slate-700">
                Confirm new password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
