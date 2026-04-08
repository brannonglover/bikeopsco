/**
 * Vercel Blob access mode.
 * Set BLOB_ACCESS=private in .env when your Blob store is configured as private.
 * Default is "public" for backward compatibility.
 */
export const BLOB_ACCESS =
  (process.env.BLOB_ACCESS as "public" | "private") || "public";

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
