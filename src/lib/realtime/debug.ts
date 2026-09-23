"use client";

/**
 * Opt-in Realtime tracing for a single browser.
 *
 * Realtime problems are the kind you cannot reproduce on demand — a channel
 * that quietly stopped delivering looks exactly like a shop with no new jobs.
 * This turns on a timestamped console trace of the whole path (subscribe →
 * broadcast received → board invalidated → refetch landed) for whoever asks
 * for it, without putting noise in every staff member's console.
 *
 * Turn it on in the browser that is misbehaving, then reload:
 *
 *   localStorage.setItem("bikeops:realtime-debug", "1")
 *
 * Off again with `localStorage.removeItem("bikeops:realtime-debug")`.
 *
 * `window.__bikeopsRealtime` is populated regardless, so live channel state
 * can be inspected from the console after the fact even when tracing was off.
 */

const STORAGE_KEY = "bikeops:realtime-debug";

export type RealtimeDebugState = {
  /** Jobs channel topic this browser was authorized to join, once known. */
  jobsTopic: string | null;
  /** Last `subscribe()` status seen, e.g. SUBSCRIBED / CHANNEL_ERROR / CLOSED. */
  jobsStatus: string | null;
  /** Epoch ms of the last status transition. */
  jobsStatusAt: number | null;
  /** How many times this channel has reached SUBSCRIBED (>1 means reconnects). */
  subscribeCount: number;
  /** Epoch ms of the last broadcast received on the jobs channel. */
  lastEventAt: number | null;
  /** Name of that broadcast, e.g. "job:created". */
  lastEvent: string | null;
  /** Epoch ms of the last board refetch that completed. */
  lastRefetchAt: number | null;
  /** Broadcasts received since page load. */
  eventCount: number;
};

export const realtimeDebugState: RealtimeDebugState = {
  jobsTopic: null,
  jobsStatus: null,
  jobsStatusAt: null,
  subscribeCount: 0,
  lastEventAt: null,
  lastEvent: null,
  lastRefetchAt: null,
  eventCount: 0,
};

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__bikeopsRealtime =
    realtimeDebugState;
}

let enabled: boolean | null = null;

export function isRealtimeDebugEnabled(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === "undefined") return false;
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / disabled storage — just stay quiet.
    enabled = false;
  }
  return enabled;
}

/** Timestamped trace line, emitted only when this browser opted in. */
export function realtimeLog(scope: string, message: string, detail?: unknown): void {
  if (!isRealtimeDebugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  if (detail === undefined) {
    console.log(`[realtime ${stamp}] ${scope}: ${message}`);
  } else {
    console.log(`[realtime ${stamp}] ${scope}: ${message}`, detail);
  }
}
