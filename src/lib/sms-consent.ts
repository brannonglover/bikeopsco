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

type EmailUpdatesConsentLike = {
  email: string | null;
  emailUpdatesConsent?: boolean | null;
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

/** Only write consent fields when the customer opts in (never clear on re-booking). */
export function buildSmsConsentOptInUpdate(
  smsConsent: boolean,
  smsConsentSource: string
) {
  if (!smsConsent) return {};
  return buildSmsConsentUpdate(true, smsConsentSource);
}

type SmsConsentRecordLike = SmsConsentLike & {
  smsConsentSource?: string | null;
};

/** When merging customers, keep opt-in from either profile unless target explicitly opted out. */
export function mergeSmsConsentFields(
  target: SmsConsentRecordLike,
  source: SmsConsentRecordLike
) {
  if (!source.smsConsent) return {};
  if (target.smsConsent) return {};
  if (target.smsConsentUpdatedAt && !target.smsConsent) return {};
  return {
    smsConsent: true,
    smsConsentSource: source.smsConsentSource ?? "MERGE",
    smsConsentUpdatedAt: source.smsConsentUpdatedAt ?? new Date(),
  };
}

export function buildEmailUpdatesConsentUpdate(
  emailUpdatesConsent: boolean,
  emailUpdatesConsentSource: string
) {
  return {
    emailUpdatesConsent,
    emailUpdatesConsentSource,
    emailUpdatesConsentUpdatedAt: new Date(),
  };
}

export function getEffectiveEmailUpdatesConsent(
  customer: EmailUpdatesConsentLike | null | undefined
): boolean {
  if (!customer?.email?.trim()) return false;
  return customer.emailUpdatesConsent !== false;
}

/**
 * Customers must explicitly opt in before receiving service-related texts.
 * Once smsConsent is true it stays effective until an explicit opt-out writes false
 * (STOP, preferences, status page). Legacy rows without smsConsentUpdatedAt still
 * honor smsConsent when true.
 */
export function getEffectiveSmsConsent(customer: SmsConsentLike | null | undefined): boolean {
  if (!customer?.phone?.trim()) return false;
  return customer.smsConsent === true;
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
