/** Matches eBike, e-bike, ebike, or e bike in a service name (case-insensitive). */
const EBIKE_SERVICE_NAME_PATTERN = /\b(e-?bike|e\s*bike|ebike)\b/i;

export function serviceNameMentionsEbike(name: string): boolean {
  return EBIKE_SERVICE_NAME_PATTERN.test(name.trim());
}

/** Tailwind classes for rows/options whose service name mentions an e-bike. */
export const EBIKE_SERVICE_HIGHLIGHT_ROW_CLASS = "bg-yellow-100 hover:bg-yellow-200/80";
