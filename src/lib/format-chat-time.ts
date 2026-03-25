/** US Eastern (handles EST/EDT via IANA zone). */
const TZ = "America/New_York";

/**
 * Formats an ISO date for chat UI: time in Eastern with short zone (e.g. EST/EDT).
 */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dDay = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const nowDay = now.toLocaleDateString("en-CA", { timeZone: TZ });

  const timeWithZone: Intl.DateTimeFormatOptions = {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };

  if (dDay === nowDay) {
    return d.toLocaleTimeString("en-US", timeWithZone);
  }

  return d.toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
