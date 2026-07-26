"use client";

import { useAppVersionCheck } from "@/hooks/useAppVersionCheck";

/**
 * Soft-update notice for the staff sidebar (above Sign out).
 * Desktop-first — mobile web layout is not the target surface yet.
 * Styled for the always-dark slate sidebar (avoids light amber utilities
 * that globals.css remaps poorly under html.dark).
 */
export function VersionUpdateBanner() {
  // Soft updates are gated server-side (Production only via softUpdatesEnabled).
  // Keep the hook enabled so Preview/local clear any sticky localStorage banner.
  const { updateAvailable, releaseNotesUrl, applyUpdate } = useAppVersionCheck(true);

  if (!updateAvailable) return null;

  return (
    <div
      className="mx-2 mb-2 rounded-xl border border-amber-400/70 bg-amber-500/20 p-3 shadow-lg shadow-black/30 ring-1 ring-amber-300/30"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-semibold text-amber-50">Update available</p>
      <p className="mt-1 text-xs leading-snug text-amber-100/90">
        A newer version of Bike Ops is ready. Your current version stays until you update — refreshing
        the page will not apply it.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={applyUpdate}
          className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors touch-manipulation"
        >
          Update now
        </button>
        {releaseNotesUrl && (
          <a
            href={releaseNotesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-amber-50"
          >
            What&apos;s new
          </a>
        )}
      </div>
    </div>
  );
}
