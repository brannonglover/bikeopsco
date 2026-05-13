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
const POSTHOG_OPT_OUT_STORAGE_KEY = "bikeops_posthog_opt_out";

let posthogInitialized = false;

function hasPostHogOptedOut() {
  if (typeof window === "undefined") {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  const optOut = params.get("posthog_opt_out");

  try {
    if (optOut === "1" || optOut === "true") {
      window.localStorage.setItem(POSTHOG_OPT_OUT_STORAGE_KEY, "1");
    } else if (optOut === "0" || optOut === "false") {
      window.localStorage.removeItem(POSTHOG_OPT_OUT_STORAGE_KEY);
    }

    return window.localStorage.getItem(POSTHOG_OPT_OUT_STORAGE_KEY) === "1";
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
