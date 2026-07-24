"use client";

import { useAppVersionCheck } from "@/hooks/useAppVersionCheck";

/**
 * Soft-update notice for the staff sidebar (above Sign out).
 * Desktop-first — mobile web layout is not the target surface yet.
 */
export function VersionUpdateBanner() {
  const { updateAvailable, releaseNotesUrl, applyUpdate } = useAppVersionCheck();

  if (!updateAvailable) return null;

  return (
    <div
      className="mx-2 mb-2 rounded-xl border border-amber-300/90 bg-amber-50 p-3 shadow-lg shadow-black/20 ring-1 ring-amber-200/80"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-semibold text-amber-950">Update available</p>
      <p className="mt-1 text-xs leading-snug text-amber-900/90">
        A newer version of Bike Ops is ready. Refresh when you can to get the latest changes.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={applyUpdate}
          className="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition-colors touch-manipulation"
        >
          Update now
        </button>
        {releaseNotesUrl && (
          <a
            href={releaseNotesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
          >
            What&apos;s new
          </a>
        )}
      </div>
    </div>
  );
}
