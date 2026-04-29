"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

function slugifySubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 30);
}

export default function SignupPage() {
  const [shopName, setShopName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  const previewSubdomain = useMemo(
    () => slugifySubdomain(subdomain || shopName) || "your-shop",
    [shopName, subdomain],
  );

  const handleShopNameChange = (value: string) => {
    setShopName(value);
    if (!subdomainEdited) {
      setSubdomain(slugifySubdomain(value));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName,
          subdomain,
          ownerName,
          email,
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Could not create your shop.");
        return;
      }
      setLoginUrl(data.loginUrl);
    } catch {
      setError("Could not create your shop. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loginUrl) {
    return (
      <main className="min-h-screen w-full bg-mesh px-4 py-10 text-slate-900">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col items-center justify-center">
          <div className="w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden />
            <h1 className="text-2xl font-semibold">Your shop is ready</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Sign in on your new Bike Ops workspace and start with a fresh board.
            </p>
            <Link
              href={loginUrl}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-900"
            >
              Open workspace
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-mesh px-4 py-8 text-slate-900 sm:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="space-y-6">
          <Link href="/login" className="inline-flex">
            <Image src="/bbm-logo-wo.png" alt="Bike Ops" width={220} height={74} priority />
          </Link>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Bike Ops SaaS
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl">
              Create a bike shop workspace
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
              Each shop gets its own subdomain, staff login, booking board, settings,
              templates, and customer history.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
            <span className="font-semibold text-slate-950">Workspace preview:</span>{" "}
            <span className="font-mono text-slate-800">{previewSubdomain}.{ROOT_DOMAIN}</span>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
          <h2 className="text-xl font-semibold text-slate-950">Start your workspace</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="shopName" className="mb-1 block text-sm font-medium text-slate-700">
                Shop name
              </label>
              <input
                id="shopName"
                type="text"
                value={shopName}
                onChange={(event) => handleShopNameChange(event.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="Example Bike Shop"
              />
            </div>

            <div>
              <label htmlFor="subdomain" className="mb-1 block text-sm font-medium text-slate-700">
                Subdomain
              </label>
              <div className="flex rounded-lg border border-slate-300 focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500">
                <input
                  id="subdomain"
                  type="text"
                  value={subdomain}
                  onChange={(event) => {
                    setSubdomainEdited(true);
                    setSubdomain(slugifySubdomain(event.target.value));
                  }}
                  required
                  className="min-w-0 flex-1 rounded-l-lg border-0 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-0"
                  placeholder="example"
                />
                <span className="flex items-center rounded-r-lg border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                  .{ROOT_DOMAIN}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="ownerName" className="mb-1 block text-sm font-medium text-slate-700">
                Your name
              </label>
              <input
                id="ownerName"
                type="text"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="Alex Morgan"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating workspace..." : "Create workspace"}
              {!loading && <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
