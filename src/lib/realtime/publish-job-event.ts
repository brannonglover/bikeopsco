import {
  jobChannelName,
  type JobRealtimeEvent,
  type JobRealtimePayload,
} from "@/lib/realtime/job-events";

/**
 * Server-side publisher for job Realtime events.
 *
 * Uses Supabase's HTTP broadcast endpoint rather than the websocket client:
 * serverless invocations are short-lived, and opening a Realtime socket per
 * mutation would cost a handshake and leak connections.
 *
 * Delivery is best-effort by design. A dropped broadcast degrades to the
 * board's foreground sync (visible / focus / wake), so a Realtime outage
 * never blocks or fails a job mutation.
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
          "job events will not be broadcast and staff boards will only refresh on foreground sync."
      );
    }
    return null;
  }

  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

/**
 * Broadcasts `event` to every staff client watching `shop:<shopId>:jobs`.
 *
 * Resolves rather than throws on every failure path — callers should await it
 * for prompt delivery but must never let it fail the surrounding mutation.
 */
export async function publishJobEvent(
  event: JobRealtimeEvent,
  payload: JobRealtimePayload
): Promise<void> {
  const config = getConfig();
  if (!config) return;

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
            topic: jobChannelName(payload.shopId),
            event,
            payload,
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
    }
  } catch (error) {
    // Includes the abort timeout. Clients recover on their next foreground sync.
    console.error(`[realtime] broadcast ${event} threw:`, error);
  }
}
