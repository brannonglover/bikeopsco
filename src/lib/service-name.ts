/** Matches eBike, e-bike, ebike, or e bike in a service name (case-insensitive). */
const EBIKE_SERVICE_NAME_PATTERN = /\b(e-?bike|e\s*bike|ebike)\b/i;

export function serviceNameMentionsEbike(name: string): boolean {
  return EBIKE_SERVICE_NAME_PATTERN.test(name.trim());
}

export type ServiceNamePart = { text: string; isEbike: boolean };

/** Split a service name into plain text and e-bike token segments for inline badge rendering. */
export function splitServiceNameParts(name: string): ServiceNamePart[] {
  const pattern = /\b(e-?bike|e\s*bike|ebike)\b/gi;
  const parts: ServiceNamePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(name)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: name.slice(lastIndex, match.index), isEbike: false });
    }
    parts.push({ text: match[0], isEbike: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < name.length) {
    parts.push({ text: name.slice(lastIndex), isEbike: false });
  }

  if (parts.length === 0) {
    parts.push({ text: name, isEbike: false });
  }

  return parts;
}

/** Tailwind classes for an inline e-bike badge within a service name. */
export const EBIKE_SERVICE_NAME_BADGE_CLASS =
  "text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 align-middle";
