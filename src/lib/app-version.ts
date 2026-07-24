import { DEFAULT_ROOT_DOMAIN } from "@/lib/tenant-domain";
import { findPublishedRelease } from "@/lib/releases";

/** Current deploy identity (git SHA on Vercel; stable local fallback). */
export function getAppVersion(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  return sha || "local-dev";
}

export function getMarketingSiteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_MARKETING_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `https://${DEFAULT_ROOT_DOMAIN}`;
}

/** Prefer a specific release page when published; otherwise the releases index. */
export function getReleaseNotesUrl(version: string): string {
  const base = getMarketingSiteBaseUrl();
  const release = findPublishedRelease(version);
  if (release) return `${base}/releases/${release.slug}`;
  return `${base}/releases`;
}

export type AppVersionPayload = {
  version: string;
  releaseNotesUrl: string;
};

export function getAppVersionPayload(): AppVersionPayload {
  const version = getAppVersion();
  return {
    version,
    releaseNotesUrl: getReleaseNotesUrl(version),
  };
}
