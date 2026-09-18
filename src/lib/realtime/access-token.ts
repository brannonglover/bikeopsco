"use client";

/**
 * Browser-side cache for the Realtime token issued by `/api/realtime/token`.
 *
 * supabase-js calls its `accessToken` hook often and concurrently, so this
 * memoizes the current token and collapses simultaneous callers onto one
 * in-flight request. Nothing is written to localStorage or cookies: the token
 * lives in module memory for its few minutes and dies with the page. The
 * NextAuth cookie remains the only persisted credential.
 */

export type RealtimeAuth = {
  token: string;
  shopId: string;
  channel: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

/** Refresh this far ahead of expiry so a request never rides an expired token. */
const REFRESH_MARGIN_MS = 45_000;

let cached: RealtimeAuth | null = null;
let inFlight: Promise<RealtimeAuth | null> | null = null;

function isUsable(auth: RealtimeAuth | null): auth is RealtimeAuth {
  return auth !== null && auth.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

async function requestAuth(): Promise<RealtimeAuth | null> {
  try {
    const res = await fetch("/api/realtime/token", { cache: "no-store" });
    if (!res.ok) {
      // 401 means the staff session ended; 503 means Realtime is unconfigured.
      // Either way the board falls back to foreground sync.
      console.warn(`[realtime] token request failed (${res.status})`);
      return null;
    }

    const data = (await res.json()) as Partial<RealtimeAuth>;
    if (!data.token || !data.shopId || !data.channel || !data.expiresAt) {
      console.warn("[realtime] token response was malformed");
      return null;
    }

    cached = {
      token: data.token,
      shopId: data.shopId,
      channel: data.channel,
      expiresAt: data.expiresAt,
    };
    return cached;
  } catch (error) {
    console.warn("[realtime] token request threw:", error);
    return null;
  }
}

/** Current Realtime credentials, refreshing only when near expiry. */
export async function getRealtimeAuth(): Promise<RealtimeAuth | null> {
  if (isUsable(cached)) return cached;

  // Collapse concurrent callers — supabase-js may ask from several channels at once.
  if (!inFlight) {
    inFlight = requestAuth().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** The `accessToken` hook handed to `createClient`. */
export async function getRealtimeAccessToken(): Promise<string | null> {
  const auth = await getRealtimeAuth();
  return auth?.token ?? null;
}

/** Drops the cached token — call when staff sync is disabled or the user signs out. */
export function clearRealtimeAuth(): void {
  cached = null;
}
