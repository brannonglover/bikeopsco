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
 */
export function blobDisplayUrl(blobUrl: string, pathname?: string): string {
  if (BLOB_ACCESS === "private" && pathname) {
    return `/api/blob?path=${encodeURIComponent(pathname)}`;
  }
  return blobUrl;
}
