import { parseCollectionWindowInstant } from "@/lib/collection-window-storage";
import {
  DEFAULT_SHOP_TIMEZONE,
  formatInstantInTimezone,
  getTimeZoneAbbreviation,
  normalizeIANATimezone,
} from "@/lib/timezone";

export type FormatCollectionWindowOptions = {
  /** Shop IANA timezone used when decoding legacy HH:mm values. */
  shopTimeZone?: string;
  /** Calendar date for legacy HH:mm (usually drop-off / pickup date). */
  referenceDate?: Date | string | null;
  /** Where to render times (defaults to shopTimeZone). Pass viewer TZ for browser-local display. */
  displayTimeZone?: string;
};

/**
 * Customer/staff-readable collection window range.
 * Stored values are UTC ISO; legacy HH:mm is interpreted in the shop timezone.
 */
export function formatCollectionWindowRange(
  start: string | null | undefined,
  end: string | null | undefined,
  options?: FormatCollectionWindowOptions
): string | null {
  const shopTz = normalizeIANATimezone(options?.shopTimeZone ?? DEFAULT_SHOP_TIMEZONE);
  const displayTz = normalizeIANATimezone(options?.displayTimeZone ?? shopTz);
  const ref = options?.referenceDate ?? null;

  const startInstant = parseCollectionWindowInstant(start, ref, shopTz);
  const endInstant = parseCollectionWindowInstant(end, ref, shopTz);
  if (!startInstant && !endInstant) return null;

  const fmt = (instant: Date) =>
    formatInstantInTimezone(instant, displayTz, { includeZone: false });

  const zoneRef = startInstant ?? endInstant ?? new Date();
  const zoneLabel = getTimeZoneAbbreviation(displayTz, zoneRef);

  const startLabel = startInstant ? fmt(startInstant) : null;
  const endLabel = endInstant ? fmt(endInstant) : null;

  if (startLabel && endLabel) return `${startLabel} – ${endLabel} ${zoneLabel}`;
  if (startLabel) return `from ${startLabel} ${zoneLabel}`;
  if (endLabel) return `until ${endLabel} ${zoneLabel}`;
  return null;
}
