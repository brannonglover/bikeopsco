"use client";

import { useEffect, useMemo, useState } from "react";

type OpenStaffChatPageProps = {
  appUrl: string;
  conversationId: string;
  nativeUrl: string;
  webUrl: string;
};

export function OpenStaffChatPage({
  appUrl,
  conversationId,
  nativeUrl,
  webUrl,
}: OpenStaffChatPageProps) {
  const [showFallback, setShowFallback] = useState(false);

  const displayUrl = useMemo(() => {
    try {
      return new URL(webUrl).host;
    } catch {
      return appUrl || "BikeOps";
    }
  }, [appUrl, webUrl]);

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => setShowFallback(true), 1200);
    const webFallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.href = webUrl;
      }
    }, 3200);

    window.location.href = nativeUrl;

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
