import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pathname validation and signed URLs for the private Blob proxy. Kept free
 * of database and auth imports so lib/blob.ts (used when building Twilio
 * media URLs) can depend on it cheaply.
 */

export const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

/**
 * The store pathname a `path` or `url` parameter names, or null if it isn't a
 * clean pathname in our own store. Rejects traversal, absolute paths and
 * foreign hosts so the lookup key and the fetched object are the same thing.
 */
export function normalizeBlobPathname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let pathname = raw.trim();

  if (/^https?:\/\//i.test(pathname)) {
    let url: URL;
    try {
      url = new URL(pathname);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST_SUFFIX)) return null;
    const storeId = blobStoreId();
    if (storeId && !url.hostname.startsWith(`${storeId.toLowerCase()}.`)) return null;
    try {
      pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      return null;
    }
  }

  if (!pathname || pathname.length > 512) return null;
  if (pathname.startsWith("/") || pathname.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f?#]/.test(pathname)) return null;
  const segments = pathname.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return pathname;
}

/** The store id embedded in BLOB_READ_WRITE_TOKEN (vercel_blob_rw_<id>_<secret>). */
function blobStoreId(): string | null {
  const match = /^vercel_blob_rw_([a-z0-9]+)_/i.exec(process.env.BLOB_READ_WRITE_TOKEN ?? "");
  return match ? match[1] : null;
}

// Signed URLs: for fetchers that carry no session (Twilio pulling MMS media or
// a voicemail greeting, a tracking-link viewer). Bound to one pathname and an
// expiry; the signing key never leaves the server.

/**
 * How long each kind of signed link lives. Each is the shortest that covers
 * its fetcher; the expiry is then rounded up to the hour (see below).
 */
export const SIGNED_TTL = {
  /** Twilio fetches the greeting while the call is live; TwiML is built per call. */
  voicemailGreeting: 60 * 60,
  /** Twilio fetches MMS media when it sends, which can wait in its queue up to 4 h. */
  mms: 6 * 60 * 60,
  /** A tracking-page visit; the page gets fresh links whenever it reloads the job. */
  trackingPage: 2 * 60 * 60,
  /** An open chat thread; it polls every few seconds, so its links are always fresh. */
  chatThread: 2 * 60 * 60,
} as const;

const DEFAULT_SIGNED_TTL_SECONDS = 60 * 60;

function signingKey(): string | null {
  const secret = process.env.BLOB_URL_SIGNING_SECRET || process.env.NEXTAUTH_SECRET;
  return secret ? `blob-url:${secret}` : null;
}

function signature(pathname: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`${pathname}\n${exp}`).digest("base64url");
}

/** `exp=…&sig=…` for this pathname, or null if no signing secret is configured. */
export function blobSignatureQuery(
  pathname: string,
  ttlSeconds = DEFAULT_SIGNED_TTL_SECONDS,
  now = Date.now()
): string | null {
  const key = signingKey();
  if (!key) return null;
  // Rounded up to the hour so a page that re-fetches keeps the same URL (and
  // the browser's cached copy) for a while instead of a new one every poll.
  const exp = Math.ceil((Math.floor(now / 1000) + ttlSeconds) / 3600) * 3600;
  return `exp=${exp}&sig=${signature(pathname, exp, key)}`;
}

export function verifyBlobSignature(
  pathname: string,
  exp: string | null,
  sig: string | null,
  now = Date.now()
): boolean {
  const key = signingKey();
  if (!key || !exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const expires = Number(exp);
  if (expires * 1000 <= now) return false;
  const expected = Buffer.from(signature(pathname, expires, key));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Add a signature to a `/api/blob?path=…` URL (relative or absolute) so it
 * works without a session. Anything else is returned unchanged.
 */
export function signBlobUrl(url: string, ttlSeconds = DEFAULT_SIGNED_TTL_SECONDS): string {
  const isRelative = url.startsWith("/api/blob?");
  let parsed: URL;
  try {
    parsed = new URL(url, "http://relative.invalid");
  } catch {
    return url;
  }
  if (parsed.pathname !== "/api/blob") return url;
  if (!isRelative && parsed.origin === "http://relative.invalid") return url;
  const pathname = normalizeBlobPathname(parsed.searchParams.get("path"));
  if (!pathname) return url;
  const query = blobSignatureQuery(pathname, ttlSeconds);
  if (!query) return url;
  parsed.searchParams.delete("exp");
  parsed.searchParams.delete("sig");
  const signed = `${parsed.pathname}?${parsed.searchParams.toString()}&${query}`;
  return isRelative ? signed : `${parsed.origin}${signed}`;
}
