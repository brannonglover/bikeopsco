import { getShopAppUrl } from "./env";

/**
 * Vercel Blob access mode.
 * Set BLOB_ACCESS=private in .env when your Blob store is configured as private.
 * Default is "public" for backward compatibility.
 */
export const BLOB_ACCESS =
  (process.env.BLOB_ACCESS as "public" | "private") || "public";

/** Twilio MMS outbound limits (carrier-dependent; 10 is Twilio's API max). */
export const MMS_OUTBOUND_MAX_COUNT = 10;

/** MIME types Twilio/carriers reliably accept for outbound MMS. */
export const MMS_OUTBOUND_SUPPORTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/**
 * For private stores, returns a proxy URL that serves the blob through our API.
 * For public stores, returns the direct blob URL.
 *
 * A unique timestamp is appended to private proxy URLs so each uploaded blob
 * gets a distinct browser-cacheable URL, preventing stale cached images from
 * appearing when multiple blobs share a similar pathname.
 */
export function blobDisplayUrl(blobUrl: string, pathname?: string): string {
  if (BLOB_ACCESS === "private" && pathname) {
    return `/api/blob?path=${encodeURIComponent(pathname)}&v=${Date.now()}`;
  }
  return blobUrl;
}

export type MmsAttachment = { url: string; mimeType: string };

/**
 * Resolve a chat attachment URL to an absolute HTTPS URL Twilio can fetch for MMS.
 * Public blobs use direct Vercel URLs; private blobs use the unauthenticated /api/blob proxy.
 */
export function resolveMmsMediaUrl(
  attachmentUrl: string,
  shopSubdomain?: string | null
): string | null {
  const trimmed = attachmentUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (trimmed.startsWith("http://")) {
    try {
      const host = new URL(trimmed).hostname;
      if (host === "localhost" || host.endsWith(".localhost")) {
        return null;
      }
    } catch {
      return null;
    }
    return trimmed;
  }

  if (trimmed.startsWith("/api/blob")) {
    const base = getShopAppUrl(shopSubdomain);
    if (!base) return null;
    return `${base}${trimmed}`;
  }

  return null;
}

/** Filter attachments to Twilio-compatible types and resolve publicly fetchable URLs. */
export function resolveOutboundMmsMediaUrls(
  attachments: MmsAttachment[],
  shopSubdomain?: string | null
): string[] {
  const urls: string[] = [];
  for (const att of attachments) {
    if (
      !MMS_OUTBOUND_SUPPORTED_TYPES.includes(
        att.mimeType as (typeof MMS_OUTBOUND_SUPPORTED_TYPES)[number]
      )
    ) {
      continue;
    }
    const url = resolveMmsMediaUrl(att.url, shopSubdomain);
    if (url) urls.push(url);
    if (urls.length >= MMS_OUTBOUND_MAX_COUNT) break;
  }
  return urls;
}
