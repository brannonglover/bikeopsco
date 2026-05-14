"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import posthog from "posthog-js";
import { PostHogProvider as PostHogReactProvider } from "posthog-js/react";

const POSTHOG_TOKEN =
  process.env.NEXT_PUBLIC_POSTHOG_TOKEN ||
  "phc_vKDFFaTih87w8hxDjhefDEiTtJBNdBqkKcB7Hc5SToT4";
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const POSTHOG_SITE = process.env.NEXT_PUBLIC_POSTHOG_SITE || "bikeopsco";
const POSTHOG_OPT_OUT_COOKIE = "bikeops_posthog_opt_out";
const OPT_OUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

let posthogInitialized = false;

function getCookieDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "";
  const parts = host.split(".");
  return parts.length >= 2
    ? `.${parts.slice(-2).join(".")}`
    : `.${host}`;
}

function setOptOutCookie(value: boolean) {
  const domain = getCookieDomain();
  const domainAttr = domain ? `; domain=${domain}` : "";
  if (value) {
    document.cookie = `${POSTHOG_OPT_OUT_COOKIE}=1; path=/; max-age=${OPT_OUT_COOKIE_MAX_AGE}; SameSite=Lax${domainAttr}`;
  } else {
    document.cookie = `${POSTHOG_OPT_OUT_COOKIE}=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
  }
}

function readOptOutCookie(): boolean {
  return document.cookie.split("; ").some((c) => c === `${POSTHOG_OPT_OUT_COOKIE}=1`);
}

function isLocalDev(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function hasPostHogOptedOut() {
  if (typeof window === "undefined") {
    return true;
  }

  if (isLocalDev()) {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  const optOut = params.get("posthog_opt_out");

  try {
    if (optOut === "1" || optOut === "true") {
      setOptOutCookie(true);
    } else if (optOut === "0" || optOut === "false") {
      setOptOutCookie(false);
    }

    return readOptOutCookie();
  } catch {
    return optOut === "1" || optOut === "true";
  }
}

function initPostHog() {
  if (posthogInitialized || posthog.__loaded) {
    posthogInitialized = posthog.__loaded;
    return;
  }

  if (!POSTHOG_TOKEN || hasPostHogOptedOut()) {
    return;
  }

  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_HOST,
    defaults: "2026-01-30",
    capture_pageview: false,
  });
  posthog.register({ site: POSTHOG_SITE });
  posthogInitialized = true;
}

function PostHogIdentity() {
  const { data: session, status } = useSession();
  const user = session?.user;

  useEffect(() => {
    if (!posthogInitialized || status === "loading") {
      return;
    }

    if (!user?.id) {
      posthog.reset();
      posthog.register({ site: POSTHOG_SITE });
      return;
    }

    posthog.identify(user.id, {
      email: user.email,
      name: user.name,
      shop_id: user.shopId,
      shop_subdomain: user.shopSubdomain,
      site: POSTHOG_SITE,
    });
  }, [status, user?.email, user?.id, user?.name, user?.shopId, user?.shopSubdomain]);

  return null;
}

function PostHogPageviews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = useMemo(() => {
    if (!pathname) {
      return "";
    }

    const queryString = searchParams.toString();
    return `${pathname}${queryString ? `?${queryString}` : ""}`;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!posthogInitialized || !url || typeof window === "undefined") {
      return;
    }

    posthog.capture("$pageview", {
      site: POSTHOG_SITE,
      $current_url: window.location.href,
      path: url,
    });
  }, [url]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(posthogInitialized);

  useEffect(() => {
    initPostHog();
    setReady(posthogInitialized);
  }, []);

  return (
    <PostHogReactProvider client={posthog}>
      {children}
      {ready ? (
        <>
          <PostHogIdentity />
          <Suspense fallback={null}>
            <PostHogPageviews />
          </Suspense>
        </>
      ) : null}
    </PostHogReactProvider>
  );
}
