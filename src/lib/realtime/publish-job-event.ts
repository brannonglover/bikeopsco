import "server-only";

import { broadcastRealtimeEvent } from "@/lib/realtime/broadcast";
import {
  jobChannelName,
  type JobRealtimeEvent,
  type JobRealtimePayload,
} from "@/lib/realtime/job-events";

/**
 * Broadcasts `event` to every staff client watching `shop:<shopId>:jobs`.
 *
 * Resolves rather than throws on every failure path — callers should await it
 * for prompt delivery but must never let it fail the surrounding mutation. A
 * dropped broadcast degrades to the board's foreground sync (visible / focus /
 * wake), so a Realtime outage never blocks a job mutation.
 */
export async function publishJobEvent(
  event: JobRealtimeEvent,
  payload: JobRealtimePayload
): Promise<void> {
  await broadcastRealtimeEvent({
    topic: jobChannelName(payload.shopId),
    event,
    payload,
  });
}
