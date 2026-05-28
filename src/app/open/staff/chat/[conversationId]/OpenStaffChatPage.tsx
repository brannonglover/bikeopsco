"use client";

import { useEffect, useMemo, useState } from "react";

type OpenStaffChatPageProps = {
  appUrl: string;
  conversationId: string;
  nativeUrl: string;
  webUrl: string;
};

function tryOpenNativeApp(nativeUrl: string) {
  // Avoid assigning window.location to a custom scheme — Safari shows "Can't open page"
  // and replaces the trampoline. A hidden iframe is the standard pattern on iOS.
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = nativeUrl;
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
  }, 2000);
}

export function OpenStaffChatPage({
  appUrl,
  conversationId,
  nativeUrl,
  webUrl,
}: OpenStaffChatPageProps) {
  const [showFallback, setShowFallback] = useState(false);

  const displayUrl = useMemo(() => {
    try {
      return new URL(webUrl, window.location.origin).host;
    } catch {
      try {
        return new URL(webUrl).host;
      } catch {
        return appUrl || "BikeOps";
      }
    }
  }, [appUrl, webUrl]);

  useEffect(() => {
    setShowFallback(false);
    tryOpenNativeApp(nativeUrl);

    const fallbackTimer = window.setTimeout(() => setShowFallback(true), 900);
    const webFallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.assign(webUrl);
      }
    }, 3500);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(webFallbackTimer);
    };
  }, [nativeUrl, webUrl]);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-950">
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-600">
              BikeOps
            </p>
            <h1 className="text-3xl font-bold tracking-normal">
              Opening chat
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              If BikeOps is installed, this will open the conversation in the
              app. Otherwise, you&apos;ll continue in the web app at{" "}
              {displayUrl}.
            </p>
          </div>

          {showFallback && (
            <div className="flex flex-col gap-3">
              <a
                href={nativeUrl}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
              >
                Open in BikeOps
              </a>
              <a
                href={webUrl}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900"
              >
                Continue in browser
              </a>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Conversation {conversationId}
          </p>
        </div>
      </div>
    </main>
  );
}
