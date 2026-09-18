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

export const SMS_CONSENT_SOURCES = {
  /** Customer ticked the opt-in box on their job status page. */
  STATUS_PAGE: "STATUS_PAGE",
  /** Customer ticked the opt-in box in the public booking widget. */
  BOOKING_FORM: "BOOKING_FORM",
  /** Customer texted the shop first, which is consent to be replied to. */
  INBOUND_SMS: "INBOUND_SMS",
  /**
   * Staff answered an inbound call by text. The caller reached the shop with an
   * enquiry and their number came in on caller ID, so a reply about that
   * enquiry is responsive to it — but it is a weaker record than INBOUND_SMS,
   * which the customer put in writing. Only ever set from an explicit staff
   * action on a call log entry, never automatically when a call arrives.
   */
  INBOUND_CALL: "INBOUND_CALL",
  /** Staff attested that the customer agreed verbally on a call. */
  PHONE_VERBAL: "PHONE_VERBAL",
  /** Customer replied START after a previous opt-out. */
  SMS_START: "SMS_START",
  /** Customer replied STOP. */
  SMS_STOP: "SMS_STOP",
  /** Staff recorded an opt-out on the customer's behalf. */
  STAFF_OPT_OUT: "STAFF_OPT_OUT",
  /** Carried over from a profile merge. */
  MERGE: "MERGE",
} as const;

const SMS_CONSENT_SOURCE_LABELS: Record<string, string> = {
  STATUS_PAGE: "the status page",
  BOOKING_FORM: "the booking form",
  INBOUND_SMS: "texting the shop",
  INBOUND_CALL: "a reply to their call",
  PHONE_VERBAL: "verbal consent on a call",
  SMS_START: "replying START",
  SMS_STOP: "replying STOP",
  STAFF_OPT_OUT: "a staff opt-out",
  MERGE: "a merged profile",
};

/** Human-readable consent source for staff-facing UI. */
export function describeSmsConsentSource(
  source: string | null | undefined
): string | null {
  if (!source?.trim()) return null;
  return (
    SMS_CONSENT_SOURCE_LABELS[source] ?? source.replace(/_/g, " ").toLowerCase()
  );
}

/**
 * Prisma filter matching customers whose consent has never been explicitly set:
 * the `false` default with no timestamp written. Sources that grant consent from
 * customer conduct rather than an explicit choice (currently INBOUND_SMS) must
 * scope their update to this, so that an explicit opt-out — a written
 * `smsConsentUpdatedAt` alongside `smsConsent: false`, from STOP, the status page,
 * or staff — is never silently reversed. Re-opting in takes START or an explicit
 * opt-in; carriers block outbound to a stopped number until then regardless.
 */
export const SMS_CONSENT_NEVER_SET = {
  smsConsent: false,
  smsConsentUpdatedAt: null,
} as const;

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
    // Any later consent change supersedes a prior verbal attestation, so the
    // staff attribution is cleared unless the new source sets it again.
    smsConsentCapturedBy: null as string | null,
  };
}

/**
 * Consent the customer gave verbally on a call, attested by the staff member who
 * took it. Valid prior express consent for transactional repair updates; the
 * attribution plus timestamp is the record of who took it and when.
 */
export function buildStaffVerbalSmsConsentUpdate(capturedByUserId: string) {
  return {
    ...buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.PHONE_VERBAL),
    smsConsentCapturedBy: capturedByUserId,
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
