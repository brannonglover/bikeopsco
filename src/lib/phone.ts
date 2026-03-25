import {
  AsYouType,
  parsePhoneNumber,
  isValidPhoneNumber,
} from "libphonenumber-js";

const DEFAULT_REGION = "US" as const;

/**
 * Normalize a phone number to E.164 format.
 * Returns null if the number is invalid or cannot be parsed.
 */
export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    const parsed = parsePhoneNumber(trimmed, DEFAULT_REGION);
    if (!parsed || !isValidPhoneNumber(parsed.number)) return null;
    return parsed.format("E.164");
  } catch {
    return null;
  }
}

/**
 * Prefer E.164 when the number parses; otherwise keep the trimmed string
 * (imports and edge cases).
 */
export function coerceCustomerPhone(
  phone: string | null | undefined
): string | null {
  const trimmed = phone?.trim() || "";
  if (!trimmed) return null;
  return normalizePhone(trimmed) ?? trimmed;
}

/** US national format as the user types, e.g. (555) 123-4567 */
export function formatPhoneInputUS(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (!digits) return "";
  const formatter = new AsYouType(DEFAULT_REGION);
  let formatted = "";
  for (const ch of digits) {
    formatted = formatter.input(ch);
  }
  return formatted;
}

/** Stored value → controlled input (national formatting). */
export function phoneToInputValue(phone: string | null | undefined): string {
  if (!phone?.trim()) return "";
  const normalized = normalizePhone(phone.trim());
  if (normalized) {
    try {
      const parsed = parsePhoneNumber(normalized);
      const nationalDigits = String(parsed.nationalNumber);
      return formatPhoneInputUS(nationalDigits);
    } catch {
      // fall through
    }
  }
  return formatPhoneInputUS(phone.replace(/\D/g, ""));
}

/** E.164 or arbitrary stored string → national display when parseable. */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return "";
  const trimmed = phone.trim();
  const normalized = normalizePhone(trimmed);
  if (normalized) {
    try {
      return parsePhoneNumber(normalized).formatNational();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/** `tel:` href that works with E.164 and loosely formatted numbers. */
export function phoneTelHref(phone: string): string {
  const normalized = normalizePhone(phone.trim());
  if (normalized) return `tel:${normalized}`;
  const compact = phone.replace(/\s/g, "");
  return compact ? `tel:${compact}` : "";
}
