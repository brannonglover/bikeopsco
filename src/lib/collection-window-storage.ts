import {
  isLegacyTimeOnly,
  isUtcIsoStorage,
  toCalendarDateInTimezone,
  toTimeInputInTimezone,
  zonedLocalToUtc,
  normalizeIANATimezone,
} from "@/lib/timezone";

function resolveCalendarReference(
  referenceDate: Date | string | null | undefined,
  timeZone: string
): string {
  if (typeof referenceDate === "string") {
    const trimmed = referenceDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (trimmed) return toCalendarDateInTimezone(trimmed, timeZone);
  }
  if (referenceDate instanceof Date) {
    return toCalendarDateInTimezone(referenceDate, timeZone);
  }
  return toCalendarDateInTimezone(new Date(), timeZone);
}

/** Parse stored window value to a UTC instant (legacy HH:mm uses reference calendar date). */
export function parseCollectionWindowInstant(
  stored: string | null | undefined,
  referenceDate: Date | string | null | undefined,
  timeZone: string
): Date | null {
  if (!stored?.trim()) return null;
  const tz = normalizeIANATimezone(timeZone);
  const v = stored.trim();

  if (isUtcIsoStorage(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (isLegacyTimeOnly(v)) {
    const cal = resolveCalendarReference(referenceDate, tz);
    return zonedLocalToUtc(cal, v, tz);
  }

  return null;
}

/** Persist as UTC ISO string. Accepts legacy HH:mm or existing ISO from the client. */
export function encodeCollectionWindowForStorage(
  value: string | null | undefined,
  referenceDate: Date | string | null | undefined,
  timeZone: string
): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();

  if (isUtcIsoStorage(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (isLegacyTimeOnly(v)) {
    const instant = parseCollectionWindowInstant(v, referenceDate, timeZone);
    return instant?.toISOString() ?? null;
  }

  return null;
}

/** Value for &lt;input type="time"&gt; in the shop timezone. */
export function decodeCollectionWindowForInput(
  stored: string | null | undefined,
  referenceDate: Date | string | null | undefined,
  timeZone: string
): string {
  const instant = parseCollectionWindowInstant(stored, referenceDate, timeZone);
  if (!instant) {
    if (stored && isLegacyTimeOnly(stored)) return stored.trim();
    return "";
  }
  return toTimeInputInTimezone(instant, timeZone);
}

export function encodeCollectionWindowPairForStorage(
  start: string | null | undefined,
  end: string | null | undefined,
  referenceDate: Date | string | null | undefined,
  timeZone: string
): { start: string | null; end: string | null } {
  return {
    start: encodeCollectionWindowForStorage(start, referenceDate, timeZone),
    end: encodeCollectionWindowForStorage(end, referenceDate, timeZone),
  };
}
