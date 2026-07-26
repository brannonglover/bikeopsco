import { DEFAULT_ROOT_DOMAIN } from "@/lib/tenant-domain";
import {
  findDraftReleaseByGitSha,
  findPublishedReleaseByGitSha,
  getReleaseNotesPublicUrl,
} from "@/lib/platform-releases";

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

export type AppVersionPayload = {
  version: string;
  versionLabel: string | null;
  /** False while a draft exists for this deploy and notes are not published yet. */
  updateReady: boolean;
  releaseNotesUrl: string;
};

export async function getAppVersionPayload(): Promise<AppVersionPayload> {
  const version = getAppVersion();
  const published = await findPublishedReleaseByGitSha(version).catch(() => null);
  const draft = published
    ? null
    : await findDraftReleaseByGitSha(version).catch(() => null);

  // Published → ready. Draft pending approval → not ready. No row (notes skipped) → ready.
  const updateReady = published != null || draft == null;

  return {
    version,
    versionLabel: published?.version ?? null,
    updateReady,
    releaseNotesUrl: getReleaseNotesPublicUrl(published?.version ?? null),
  };
}
