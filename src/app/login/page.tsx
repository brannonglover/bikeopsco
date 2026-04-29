"use client";

import { useEffect, useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

function normalizeSubdomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 30);
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [loginMode, setLoginMode] = useState<"checking" | "workspace" | "credentials">("checking");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/calendar";

  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase();
    const workspaceHost =
      hostname === `app.${ROOT_DOMAIN}` ||
      hostname === "app.localhost" ||
      hostname === "app.lvh.me";
    setLoginMode(workspaceHost ? "workspace" : "credentials");
  }, []);

  const handleWorkspaceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const subdomain = normalizeSubdomain(workspace);
    if (!subdomain || subdomain.length < 3) {
      setError("Enter your shop subdomain.");
      return;
    }

    const current = new URL(window.location.href);
    if (current.hostname === "app.localhost" || current.hostname === "localhost") {
      current.hostname = `${subdomain}.localhost`;
    } else if (current.hostname === "app.lvh.me" || current.hostname.endsWith(".lvh.me")) {
      current.hostname = `${subdomain}.lvh.me`;
    } else {
      current.protocol = "https:";
      current.hostname = `${subdomain}.${ROOT_DOMAIN}`;
      current.port = "";
    }
    current.pathname = "/login";
    current.search = "";
    window.location.href = current.toString();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }
      window.location.href = callbackUrl;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  if (loginMode === "checking") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-mesh p-4 text-slate-600">
        Loading...
      </div>
    );
  }

  if (loginMode === "workspace") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-mesh p-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="mb-6 flex justify-center">
            <Image src="/bike-ops-logo.png" alt="Bike Ops" width={200} height={100} />
          </div>
          <h1 className="mb-2 text-center text-xl font-semibold text-slate-900">Find your workspace</h1>
          <p className="mb-6 text-center text-sm leading-6 text-slate-600">
            Enter the shop subdomain you chose during signup.
          </p>
          <form onSubmit={handleWorkspaceSubmit} className="space-y-4">
            <div>
              <label htmlFor="workspace" className="mb-1 block text-sm font-medium text-slate-700">
                Shop subdomain
              </label>
              <div className="flex rounded-lg border border-slate-300 focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500">
                <input
                  id="workspace"
                  type="text"
                  autoComplete="organization"
                  value={workspace}
                  onChange={(event) => setWorkspace(normalizeSubdomain(event.target.value))}
                  required
                  className="min-w-0 flex-1 rounded-l-lg border-0 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-0"
                  placeholder="bbm"
                />
                <span className="flex items-center rounded-r-lg border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                  .{ROOT_DOMAIN}
                </span>
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white hover:bg-slate-800"
            >
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-600">
            New to Bike Ops?{" "}
            <Link href="/signup" className="font-semibold text-slate-900 hover:underline">
              Create a shop
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-mesh p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex justify-center">
          <Image src="/bbm-logo-wo.png" alt="Bike Ops" width={200} height={67} />
        </div>
        <h1 className="mb-6 text-center text-xl font-semibold text-slate-900">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="••••••••"
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
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          Need a workspace?{" "}
          <Link href="/signup" className="font-semibold text-slate-900 hover:underline">
            Create a shop
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-mesh">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
