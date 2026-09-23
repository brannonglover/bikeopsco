import "server-only";

/**
 * Shared server-side publisher for Supabase Realtime broadcasts.
 *
 * Uses Supabase's HTTP broadcast endpoint rather than the websocket client:
 * serverless invocations are short-lived, and opening a Realtime socket per
 * mutation would cost a handshake and leak connections.
 *
 * Delivery is best-effort by design. A dropped broadcast degrades to the
 * subscriber's existing catch-up path (foreground sync, or the chat SSE
 * stream), so a Realtime outage never blocks or fails the surrounding write.
 */

const BROADCAST_TIMEOUT_MS = 1_500;

let warnedUnconfigured = false;

function getConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[realtime] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
          "events will not be broadcast and staff clients will only refresh on " +
          "foreground sync or their polling fallback."
      );
    }
    return null;
  }

  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

/**
 * Broadcasts `event` to every client subscribed to `topic`.
 *
 * Resolves rather than throws on every failure path — callers should await it
 * for prompt delivery but must never let it fail the surrounding mutation.
 */
export async function broadcastRealtimeEvent({
  topic,
  event,
  payload,
}: {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const publishedAt = Date.now();

  try {
    const res = await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic,
            event,
            // `at` is stamped here rather than by each caller so every channel
            // carries it: subscribers log the gap between publish and receipt,
            // which is what separates "the event was slow" from "the event
            // never arrived" when a board looks stale.
            payload: { ...payload, at: publishedAt },
            // The channel is RLS-protected; the service role key is what
            // authorizes this publish. Subscribers get read access only.
            private: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(
        `[realtime] broadcast ${event} failed:`,
        res.status,
        await res.text().catch(() => "")
      );
      return;
    }

    // Logged on success too: without it a silent board is ambiguous between
    // "nothing was published" and "it was published and never delivered", and
    // only one of those is a client problem.
    console.log(
      `[realtime] broadcast ${event} -> ${topic} ok in ${Date.now() - publishedAt}ms`
    );
  } catch (error) {
    // Includes the abort timeout. Clients recover on their next catch-up.
    console.error(`[realtime] broadcast ${event} threw:`, error);
  }
}
