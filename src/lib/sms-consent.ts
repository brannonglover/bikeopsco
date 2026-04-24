export const SMS_STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);

export const SMS_START_KEYWORDS = new Set([
  "START",
  "YES",
  "UNSTOP",
]);

export const SMS_HELP_KEYWORDS = new Set([
  "HELP",
  "INFO",
]);

type SmsConsentLike = {
  phone: string | null;
  smsConsent: boolean;
  smsConsentUpdatedAt: Date | string | null;
};

export function buildSmsConsentUpdate(
  smsConsent: boolean,
  smsConsentSource: string
) {
  return {
    smsConsent,
    smsConsentSource,
    smsConsentUpdatedAt: new Date(),
  };
}

/**
 * Existing customers created before consent tracking was added are treated as
 * legacy opt-ins until they explicitly change their preference.
 */
export function getEffectiveSmsConsent(customer: SmsConsentLike | null | undefined): boolean {
  if (!customer?.phone) return false;
  if (customer.smsConsentUpdatedAt) return customer.smsConsent;
  return true;
}

export function parseSmsConsentKeyword(
  body: string | null | undefined
): "stop" | "start" | "help" | null {
  const normalized = body?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  if (SMS_STOP_KEYWORDS.has(normalized)) return "stop";
  if (SMS_START_KEYWORDS.has(normalized)) return "start";
  if (SMS_HELP_KEYWORDS.has(normalized)) return "help";
  return null;
}
