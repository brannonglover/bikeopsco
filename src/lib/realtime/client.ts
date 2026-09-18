"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRealtimeAccessToken } from "@/lib/realtime/access-token";

/**
 * Lazily-created browser Supabase client, used only for Realtime.
 *
 * Wired to NextAuth through the `accessToken` hook — supabase-js's supported
 * entry point for a third-party auth system. Every socket connect and periodic
 * re-auth pulls a fresh short-lived token from `/api/realtime/token`, which
 * derives the shop from the NextAuth session server-side. No Supabase auth
 * session is created, and nothing is persisted to browser storage.
 */

let client: SupabaseClient | null = null;
let warnedUnconfigured = false;

/** Returns the shared Realtime client, or `null` when Supabase env vars are absent. */
export function getRealtimeClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[realtime] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set — " +
          "the board will only refresh on foreground sync."
      );
    }
    return null;
  }

  if (!client) {
    client = createClient(url, anonKey, {
      accessToken: getRealtimeAccessToken,
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }

  return client;
}
