/**
 * Spam scoring for public booking submissions.
 *
 * Turnstile already guards `/api/widget/book`, and it is still the first line
 * of defence — but it only asks "is a browser driving this", and the spam that
 * reached the board in September 2026 was arriving with valid tokens. Those
 * four bookings all looked the same: every free-text field filled with random
 * letters ("Vwxogt Ujfrgepu" booking a "bUlyDdUbbPCAhKLVtMZotMPP").
 *
 * So this module judges the *content* instead. Each field is scored on its own
 * and the signals are added up; a booking is quarantined only when the total
 * clears `QUARANTINE_THRESHOLD`.
 *
 * The design rule that matters most is that no single signal can quarantine a
 * booking on its own, and the name signals are capped below the threshold on
 * purpose. A bigram model genuinely cannot tell "Zixubany" from "Yilmaz", and
 * the cost of those two mistakes is not symmetric: holding a real customer's
 * booking because a detector found their name improbable is much worse than
 * letting one spam booking through. A real customer with an unusual name still
 * types a real bike make, a working phone number and a deliverable email, so
 * requiring corroboration across fields costs almost no detection.
 */
import { normalizePhone } from "@/lib/phone";
import { ALPHABET_SIZE, BIGRAM_LOG_PROBS } from "@/lib/gibberish-model";

export type SpamSignal = {
  /** Stable identifier, so signals can be counted without parsing prose. */
  code: string;
  /** Staff-facing explanation shown on the review screen. */
  label: string;
  weight: number;
};

export type SpamAssessment = {
  score: number;
  signals: SpamSignal[];
  quarantine: boolean;
};

/** Total score at or above which a booking is held for staff review. */
export const QUARANTINE_THRESHOLD = 60;

/**
 * Names can contribute at most this much — below the threshold by design, so
 * an unusual name never quarantines a booking without corroboration.
 */
const MAX_NAME_SCORE = 50;

const WEIGHTS = {
  firstNameRandom: 25,
  lastNameRandom: 25,
  bikeMakeRandom: 30,
  bikeModelRandom: 20,
  caseNoise: 40,
  emailRandom: 20,
  notesLink: 30,
  notesManyLinks: 20,
  disposableEmail: 25,
  unparseablePhone: 15,
} as const;

/**
 * Throwaway-inbox providers. Deliberately short: this list is a corroborating
 * signal, never a reason to hold a booking on its own, and a stale entry here
 * should not cost a real customer anything.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "mailnesia.com", "mintemail.com", "spamgourmet.com",
  "tempr.email", "emailondeck.com", "moakt.com", "mohmal.com",
]);

const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|ru|cn|top|xyz|shop|info|biz|online|site)\b)/gi;

/** Strip accents and non-letters, matching the model's training normalization. */
function normalizeWord(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function symbolIndex(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 97 || code > 122) return -1;
  return code - 96;
}

/**
 * Mean bigram log probability of a word — higher is more word-like. Must stay
 * in step with `scoreWord` in `scripts/build-gibberish-model.js`.
 */
export function wordScore(raw: string): number {
  const word = normalizeWord(raw);
  if (word.length < 4) return 0;

  let total = 0;
  let transitions = 0;
  let prev = 0; // start boundary

  for (const ch of word) {
    const idx = symbolIndex(ch);
    if (idx < 0) continue;
    total += BIGRAM_LOG_PROBS[prev * ALPHABET_SIZE + idx];
    transitions++;
    prev = idx;
  }
  total += BIGRAM_LOG_PROBS[prev * ALPHABET_SIZE]; // end boundary
  transitions++;

  return total / transitions;
}

/**
 * Whether a single word looks like random letters rather than something a
 * person typed.
 *
 * Words shorter than six letters are never judged: at that length the model
 * cannot separate a real short surname from a random one, and guessing would
 * only produce false positives. The threshold tightens with length because a
 * longer word gives the model more evidence — see the calibration report from
 * `node scripts/build-gibberish-model.js`.
 */
export function isGibberish(raw: string): boolean {
  const length = normalizeWord(raw).length;
  if (length < 6) return false;
  const threshold = length >= 10 ? -3.4 : -3.8;
  return wordScore(raw) < threshold;
}

/** True when any whitespace-separated word in the phrase looks random. */
function phraseLooksRandom(value: string | null | undefined): boolean {
  if (!value) return false;
  return value
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .some(isGibberish);
}

/**
 * Case flipping inside a word — "bUlyDdUbbPCAh" — which is what a random
 * string generator produces and what a person essentially never types. Real
 * exceptions ("McDonald", "LeMond", "iPhone") flip once, so three internal
 * transitions is the floor.
 */
export function hasCaseNoise(value: string | null | undefined): boolean {
  if (!value) return false;

  for (const token of value.split(/\s+/)) {
    const letters = token.replace(/[^A-Za-z]/g, "");
    if (letters.length < 6) continue;

    let transitions = 0;
    for (let i = 1; i < letters.length; i++) {
      const prevUpper = letters[i - 1] === letters[i - 1].toUpperCase();
      const currUpper = letters[i] === letters[i].toUpperCase();
      if (prevUpper !== currUpper) transitions++;
    }
    if (transitions >= 3) return true;
  }

  return false;
}

export type BookingSpamInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string | null;
  customerNotes?: string | null;
  bikes: { make: string; model?: string | null }[];
};

/**
 * Score a booking submission. Pure and side-effect free so it can be exercised
 * directly against real and spam samples.
 */
export function assessBookingForSpam(input: BookingSpamInput): SpamAssessment {
  const signals: SpamSignal[] = [];
  const add = (code: string, label: string, weight: number) => {
    signals.push({ code, label, weight });
  };

  // --- Name: capped below the threshold, never decisive on its own.
  let nameScore = 0;
  if (phraseLooksRandom(input.firstName)) {
    nameScore += WEIGHTS.firstNameRandom;
    add("first_name_random", "First name looks like random letters", WEIGHTS.firstNameRandom);
  }
  if (phraseLooksRandom(input.lastName)) {
    nameScore += WEIGHTS.lastNameRandom;
    add("last_name_random", "Last name looks like random letters", WEIGHTS.lastNameRandom);
  }
  const nameOverflow = Math.max(0, nameScore - MAX_NAME_SCORE);

  // --- Bike make and model: a real booking names a real bike.
  if (input.bikes.some((b) => phraseLooksRandom(b.make))) {
    add("bike_make_random", "Bike make looks like random letters", WEIGHTS.bikeMakeRandom);
  }
  if (input.bikes.some((b) => phraseLooksRandom(b.model))) {
    add("bike_model_random", "Bike model looks like random letters", WEIGHTS.bikeModelRandom);
  }

  // --- Case noise anywhere in the submission.
  const freeText = [
    input.firstName,
    input.lastName,
    input.address ?? "",
    input.customerNotes ?? "",
    ...input.bikes.flatMap((b) => [b.make, b.model ?? ""]),
  ];
  if (freeText.some(hasCaseNoise)) {
    add("case_noise", "Random capitalisation inside a word", WEIGHTS.caseNoise);
  }

  // --- Email.
  const email = input.email.trim().toLowerCase();
  const atIndex = email.lastIndexOf("@");
  const localPart = atIndex > 0 ? email.slice(0, atIndex) : "";
  const domain = atIndex > 0 ? email.slice(atIndex + 1) : "";

  // Score the separated parts rather than the whole local part: plenty of real
  // addresses are "first.last", and glueing those together produces a string no
  // bigram model recognises even though both halves are ordinary names.
  const localSegments = localPart.split(/[._+\-0-9]+/).filter(Boolean);
  if (localSegments.some(isGibberish)) {
    add("email_random", "Email address looks machine-generated", WEIGHTS.emailRandom);
  }
  if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    add("disposable_email", "Disposable email domain", WEIGHTS.disposableEmail);
  }

  // --- Notes: links are the classic payload of booking-form spam.
  const notes = input.customerNotes ?? "";
  const linkMatches = notes.match(URL_PATTERN);
  if (linkMatches && linkMatches.length > 0) {
    add("notes_link", "Notes contain a link", WEIGHTS.notesLink);
    if (linkMatches.length >= 2) {
      add("notes_many_links", "Notes contain several links", WEIGHTS.notesManyLinks);
    }
  }

  // --- Phone.
  if (!normalizePhone(input.phone)) {
    add("phone_unparseable", "Phone number is not a valid number", WEIGHTS.unparseablePhone);
  }

  const score =
    signals.reduce((sum, signal) => sum + signal.weight, 0) - nameOverflow;

  return {
    score,
    signals,
    quarantine: score >= QUARANTINE_THRESHOLD,
  };
}
