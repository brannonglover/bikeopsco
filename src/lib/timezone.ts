export const DEFAULT_SHOP_TIMEZONE = "America/New_York";

/** Common US shop timezones for settings UI. */
export const US_SHOP_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (MST, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HST)" },
] as const;

export function normalizeIANATimezone(tz: string | null | undefined): string {
  const trimmed = tz?.trim();
  if (!trimmed) return DEFAULT_SHOP_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return DEFAULT_SHOP_TIMEZONE;
  }
}

export function getViewerTimezone(): string {
  if (typeof Intl === "undefined") return DEFAULT_SHOP_TIMEZONE;
  return normalizeIANATimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** Calendar date YYYY-MM-DD for an instant in an IANA timezone. */
export function toCalendarDateInTimezone(
  instant: Date | string,
  timeZone: string
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeIANATimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** HH:mm (24h) for an instant in an IANA timezone — for &lt;input type="time"&gt;. */
export function toTimeInputInTimezone(
  instant: Date | string,
  timeZone: string
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = getLocalParts(d, normalizeIANATimezone(timeZone));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Combine local calendar date + HH:mm in a zone → UTC instant. */
export function zonedLocalToUtc(
  calendarDate: string,
  hhmm: string,
  timeZone: string
): Date | null {
  const tz = normalizeIANATimezone(timeZone);
  const trimmed = hhmm.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate) || !/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return null;
  }

  const [year, month, day] = calendarDate.split("-").map(Number);
  const [hour, minute] = trimmed.split(":").map((x) => parseInt(x, 10));
  if (
    [year, month, day, hour, minute].some((n) => Number.isNaN(n)) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 8; i++) {
    const actual = getLocalParts(new Date(utc), tz);
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actualMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0
    );
    const diff = targetMs - actualMs;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

export function getTimeZoneAbbreviation(
  timeZone: string,
  referenceDate: Date = new Date()
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeIANATimezone(timeZone),
    timeZoneName: "short",
  }).formatToParts(referenceDate);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "ET";
}

/** 12-hour time with zone label for a UTC instant in the given timezone. */
export function formatInstantInTimezone(
  instant: Date | string,
  timeZone: string,
  opts?: { includeZone?: boolean }
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";

  const tz = normalizeIANATimezone(timeZone);
  const formatted = d.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (opts?.includeZone === false) return formatted;
  return `${formatted} ${getTimeZoneAbbreviation(tz, d)}`;
}

export function isUtcIsoStorage(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value.trim());
}

export function isLegacyTimeOnly(value: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(value.trim());
}
