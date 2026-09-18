/**
 * Shared vocabulary for the job/booking Realtime channel.
 *
 * Isomorphic: imported by both the server publisher (`publish-job-event.ts`)
 * and the browser subscriber (`useJobRealtime`), so it must not pull in
 * anything server-only.
 *
 * Events are deliberately *notifications*, not state transfer. The payload
 * carries only enough to identify what changed; the board always refetches
 * `/api/jobs?view=board`, which remains the source of truth.
 */

export const JOB_REALTIME_EVENTS = [
  "job:created",
  "job:updated",
  "job:deleted",
  "job:status_changed",
  "job:approval_received",
] as const;

export type JobRealtimeEvent = (typeof JOB_REALTIME_EVENTS)[number];

export type JobRealtimePayload = {
  jobId: string;
  shopId: string;
};

/** Realtime topic carrying job events for a single shop. */
export function jobChannelName(shopId: string): string {
  return `shop:${shopId}:jobs`;
}
