export const JOBS_REFRESH_EVENT = "bikeops:jobs-refresh";

export function broadcastJobsRefresh(detail?: { reason?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(JOBS_REFRESH_EVENT, { detail }));
}

