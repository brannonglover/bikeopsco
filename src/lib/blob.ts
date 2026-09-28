import { getShopAppUrl } from "./env";

/**
 * Vercel Blob access mode.
 * Set BLOB_ACCESS=private in .env when your Blob store is configured as private.
 * Default is "public" for backward compatibility.
 */
export const BLOB_ACCESS =
  (process.env.BLOB_ACCESS as "public" | "private") || "public";

/**
 * Version of Vercel Blob's HTTP API that our @vercel/blob release speaks.
 *
 * Every SDK request carries it, but the SDK doesn't export it, so callers that
 * build the request by hand have to mirror it. Omitting it fails the upload
 * with a 400 whose message ("Invalid pathname") points nowhere near the cause.
 * Bump this when @vercel/blob is upgraded.
 */
const BLOB_API_VERSION = "12";

/**
 * The URL and headers a client needs to PUT a file straight to Blob storage.
 *
 * Native clients can't use the SDK's put() — it sends a stream body React
 * Native's fetch won't produce — so they issue the request themselves. Handing
 * them the headers keeps that request correct from the server side: a newly
 * required header ships with a deploy instead of waiting on an app release.
 */
export function blobClientUploadRequest(
  pathname: string,
  clientToken: string,
  contentType: string
): { uploadUrl: string; uploadHeaders: Record<string, string> } {
  return {
    uploadUrl: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`,
    uploadHeaders: {
      authorization: `Bearer ${clientToken}`,
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-access": BLOB_ACCESS,
      "x-content-type": contentType,
    },
  };
}

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

/** Audio formats Twilio's <Play> verb accepts. Notably excludes m4a/AAC. */
export const TWILIO_PLAYABLE_AUDIO_TYPES = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
] as const;

export type SniffedAudio =
  | { playable: true; contentType: "audio/wav" | "audio/mpeg"; extension: "wav" | "mp3" }
  | { playable: false; detected: string };

/**
 * Identify an audio container from its leading bytes.
 *
 * The uploaded part's declared MIME type is whatever the client claimed, and a
 * mobile FormData part is easy to mislabel — so what matters is the bytes
 * Twilio will actually try to decode. Reporting the detected container on
 * failure also makes a rejected upload diagnosable instead of mysterious.
 */
export function sniffAudioContainer(bytes: Buffer): SniffedAudio {
  if (bytes.length < 12) return { playable: false, detected: "empty or truncated file" };

  // RIFF....WAVE
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { playable: true, contentType: "audio/wav", extension: "wav" };
  }

  // MP3: an ID3 tag, or a raw frame sync (11 set bits).
  if (
    bytes.toString("ascii", 0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { playable: true, contentType: "audio/mpeg", extension: "mp3" };
  }

  // ISO base media (m4a/mp4/3gp) carries an "ftyp" box at offset 4; the brand
  // that follows is the most useful thing to report back.
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).trim();
    return { playable: false, detected: `MPEG-4 container (${brand})` };
  }

  if (bytes.toString("ascii", 0, 4) === "caff") {
    return { playable: false, detected: "Core Audio Format (CAF)" };
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { playable: false, detected: "WebM/Matroska" };
  }

  return {
    playable: false,
    detected: `unrecognized (starts with ${bytes.toString("hex", 0, 4)})`,
  };
}

/**
 * Resolve a stored media URL to an absolute HTTPS URL Twilio can fetch.
 * Public blobs use direct Vercel URLs; private blobs use the unauthenticated
 * /api/blob proxy. Shared by MMS attachments and voicemail greetings — both
 * need a URL Twilio's servers can reach without our session cookie.
 */
export function resolvePublicMediaUrl(
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

/** MMS-named alias of resolvePublicMediaUrl, so MMS call sites still read clearly. */
export function resolveMmsMediaUrl(
  attachmentUrl: string,
  shopSubdomain?: string | null
): string | null {
  return resolvePublicMediaUrl(attachmentUrl, shopSubdomain);
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
