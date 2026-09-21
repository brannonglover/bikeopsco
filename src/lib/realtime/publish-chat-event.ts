import "server-only";

import { broadcastRealtimeEvent } from "@/lib/realtime/broadcast";
import {
  chatChannelName,
  type ChatRealtimeEvent,
  type ChatRealtimePayload,
} from "@/lib/realtime/chat-events";

/**
 * Broadcasts `event` to every staff client watching `shop:<shopId>:chat`.
 *
 * Call this after the write has committed — a client that refetches on the
 * event must not race the transaction that caused it.
 *
 * Never throws. Chat already has an SSE stream that re-checks the database
 * every few seconds, so a dropped broadcast costs freshness, not correctness,
 * and must never fail the send it is announcing.
 */
export async function publishChatEvent(
  event: ChatRealtimeEvent,
  payload: ChatRealtimePayload
): Promise<void> {
  await broadcastRealtimeEvent({
    topic: chatChannelName(payload.shopId),
    event,
    payload,
  });
}
