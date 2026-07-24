/**
 * Published release notes on the marketing site (bikeops.co/releases/…).
 *
 * When you ship customer-facing notes:
 * 1. Add `marketing/releases/<slug>/index.html`
 * 2. Add an entry here keyed by the production commit SHA (full or first 7 chars)
 *
 * The update banner links to the matching release when present; otherwise it
 * falls back to the releases index.
 */

export type PublishedRelease = {
  /** URL path segment under /releases/ (e.g. "2026-07-24") */
  slug: string;
  title: string;
  date: string;
};

/**
 * Map git commit SHA → published release.
 * Prefer the full SHA from Vercel (`VERCEL_GIT_COMMIT_SHA`); short SHAs also work.
 */
export const PUBLISHED_RELEASES: Record<string, PublishedRelease> = {
  // Example (uncomment and replace when you publish notes for a deploy):
  // "abc1234": {
  //   slug: "2026-07-24",
  //   title: "Faster job board and clearer customer chat",
  //   date: "2026-07-24",
  // },
};

export function findPublishedRelease(version: string): PublishedRelease | null {
  const trimmed = version.trim();
  if (!trimmed || trimmed === "local-dev") return null;

  return (
    PUBLISHED_RELEASES[trimmed] ??
    PUBLISHED_RELEASES[trimmed.slice(0, 7)] ??
    null
  );
}
