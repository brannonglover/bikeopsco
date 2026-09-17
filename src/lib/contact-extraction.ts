import { normalizePhone } from "@/lib/phone";

/**
 * Best-effort contact details pulled out of a chat thread, for pre-filling the
 * "Create contact" form when a text arrives from a number that isn't on file.
 *
 * Everything here is a suggestion: staff confirm or correct each field before
 * it is saved, so the heuristics err toward returning null over guessing.
 */
export type ExtractedContact = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Numbers mentioned in the thread that differ from the one they texted from. */
  mentionedPhones: string[];
};

export type ContactExtractionMessage = {
  sender: string;
  body: string | null;
};

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** Digit runs long enough to be a phone number, allowing common separators. */
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g;

/**
 * "my name is dave", "this is Dave Cox", "hey it's dave".
 * Matched case-insensitively because texts are rarely capitalized, so the
 * captured words are vetted against NON_NAME_WORDS rather than by their case.
 */
const INTRO_RE =
  /\b(?:my name'?s|my name is|this is|i'?m|i am|it'?s|its)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*)?)/i;

/** "thanks, dave", "cheers — Dave Cox", "- dave" at the end of a message. */
const SIGN_OFF_RE =
  /(?:^|[\n.,!?;])[ \t]*(?:thanks|thank you|thx|ty|cheers|regards|best|sincerely|[-–—]{1,2})[\s,.!—–-]+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*)?)[\s.!]*$/i;

/** A last line that is just a name, e.g. a two-word signature. */
const BARE_SIGNATURE_RE = /^([a-z][a-z'’-]*)\s+([a-z][a-z'’-]*)\.?$/i;

/**
 * Words that turn up where a name would sit but never are one. Without this,
 * "this is regarding my bike" reads as a customer called "Regarding My".
 */
const NON_NAME_WORDS = new Set([
  // pronouns / articles / conjunctions
  "a", "an", "the", "and", "but", "or", "so", "if", "then", "than", "as",
  "i", "im", "ive", "id", "ill", "me", "my", "mine", "myself", "you", "your",
  "yours", "we", "our", "ours", "us", "he", "him", "his", "she", "her", "hers",
  "they", "them", "their", "it", "its", "this", "that", "these", "those",
  // verbs / auxiliaries
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
  "done", "have", "has", "had", "can", "cant", "could", "will", "wont", "would",
  "shall", "should", "may", "might", "must", "need", "needs", "needed",
  "want", "wants", "wanted", "going", "gonna", "get", "got", "getting", "give",
  "take", "bring", "bringing", "drop", "dropping", "pick", "picking", "call",
  "calling", "called", "text", "texting", "texted", "come", "coming", "came",
  "trying", "tried", "looking", "wondering", "hoping", "thinking", "checking",
  "asking", "sending", "sent", "leave", "leaving", "left", "put", "make",
  "made", "know", "let", "see", "seeing", "saw", "go", "went", "run", "ride",
  "riding", "rode", "work", "working", "worked", "fix", "fixing", "fixed",
  // openers / fillers / courtesy
  "hi", "hey", "hello", "yo", "sup", "morning", "afternoon", "evening", "good",
  "great", "thanks", "thank", "thx", "ty", "cheers", "please", "sorry", "sure",
  "ok", "okay", "yes", "yep", "yeah", "no", "nope", "not", "just", "still",
  "also", "actually", "really", "very", "much", "maybe", "probably", "again",
  "any", "anyway", "all", "some", "one", "two", "both", "here", "there",
  "back", "out", "in", "on", "at", "up", "down", "off", "over", "for", "from",
  "with", "about", "regarding", "re", "to", "of", "by", "into", "per",
  "what", "when", "where", "who", "whom", "how", "why", "which", "whether",
  // shop / repair vocabulary
  "bike", "bikes", "bicycle", "bicycles", "ebike", "ebikes", "cycle", "trike",
  "repair", "repairs", "repairing", "service", "servicing", "tune", "tuneup",
  "fitting", "build", "assembly", "wheel", "wheels", "tire", "tires", "tyre",
  "tyres", "tube", "brake", "brakes", "chain", "gear", "gears", "shifter",
  "derailleur", "cassette", "crank", "pedal", "pedals", "seat", "saddle",
  "handlebar", "handlebars", "fork", "frame", "spoke", "spokes", "battery",
  "motor", "shop", "store", "quote", "quotes", "price", "pricing", "cost",
  "estimate", "appointment", "booking", "slot", "time", "times", "hours",
  "today", "tomorrow", "tonight", "yesterday", "week", "weekend", "month",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "am", "pm", "ready", "done", "broken", "bent", "flat", "loose", "stuck",
  "new", "old", "first", "next", "last", "another", "quick", "question",
  // urgency / sentiment, which often follow "this is …"
  "urgent", "emergency", "important", "possible", "asap", "fine", "nothing",
  "something", "anything", "everything", "someone", "anyone", "everyone",
  "curious", "interested", "available", "free", "open", "closed", "waiting",
  "hopefully", "definitely", "absolutely", "perfect", "awesome", "cool",
  "nice", "sounds", "sound", "guys", "folks", "sir", "maam", "madam", "team",
  "thats", "theres", "whats", "hows", "youre", "lets", "gotta", "wanna",
]);

const MAX_NAME_TOKEN_LENGTH = 20;

function isPlausibleNameToken(token: string): boolean {
  const bare = token.replace(/[.'’-]/g, "");
  if (bare.length < 2 || bare.length > MAX_NAME_TOKEN_LENGTH) return false;
  if (!/^[a-z]+$/i.test(bare)) return false;
  return !NON_NAME_WORDS.has(bare.toLowerCase());
}

/** "dave" → "Dave", "o'brien" → "O'Brien". Already-capitalized input is kept. */
function titleCaseName(token: string): string {
  if (/[A-Z]/.test(token)) return token;
  return token.replace(
    /(^|[\s'’-])([a-z])/g,
    (_, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`
  );
}

type NameParts = { firstName: string; lastName: string | null };

/** Vets a captured "first [last]" phrase and formats it for display. */
function toNameParts(captured: string | undefined): NameParts | null {
  if (!captured) return null;
  const tokens = captured
    .trim()
    .replace(/[.,!?;:]+$/, "")
    .split(/\s+/)
    .slice(0, 2);
  if (tokens.length === 0) return null;
  if (!isPlausibleNameToken(tokens[0])) return null;

  const firstName = titleCaseName(tokens[0].replace(/[.,]+$/, ""));
  const second = tokens[1];
  const lastName =
    second && isPlausibleNameToken(second)
      ? titleCaseName(second.replace(/[.,]+$/, ""))
      : null;
  return { firstName, lastName };
}

/** "dave.cox@example.com" → Dave Cox. Only when the local part is separated. */
function nameFromEmail(email: string): NameParts | null {
  const localPart = email.split("@")[0] ?? "";
  const tokens = localPart.split(/[._-]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return toNameParts(tokens.slice(0, 2).join(" "));
}

function findNameInMessage(body: string): NameParts | null {
  const fromIntro = toNameParts(INTRO_RE.exec(body)?.[1]);
  if (fromIntro) return fromIntro;

  const fromSignOff = toNameParts(SIGN_OFF_RE.exec(body)?.[1]);
  if (fromSignOff) return fromSignOff;

  // A trailing line that is nothing but two name-shaped words, e.g. "Dave Cox".
  // Two tokens are required — a single trailing word is far more often a stray
  // reply ("tomorrow") than a signature.
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    const bare = BARE_SIGNATURE_RE.exec(lines[lines.length - 1]);
    if (bare) {
      const parts = toNameParts(`${bare[1]} ${bare[2]}`);
      if (parts?.lastName) return parts;
    }
  }

  return null;
}

/**
 * Scans a thread for the sender's name, email and any other phone numbers.
 *
 * Only messages the customer sent are read — staff replies carry the shop's own
 * name and address, which would otherwise be suggested back as the customer's.
 * Earliest messages are considered first because people introduce themselves in
 * their opening text.
 */
export function extractContactFromMessages(
  messages: ContactExtractionMessage[],
  options?: { excludePhone?: string | null }
): ExtractedContact {
  const bodies = messages
    .filter((message) => message.sender === "CUSTOMER")
    .map((message) => message.body?.trim())
    .filter((body): body is string => Boolean(body));

  let name: NameParts | null = null;
  let email: string | null = null;
  const mentionedPhones: string[] = [];
  const excluded = options?.excludePhone
    ? normalizePhone(options.excludePhone)
    : null;

  for (const body of bodies) {
    if (!name) {
      name = findNameInMessage(body);
    }
    if (!email) {
      email = EMAIL_RE.exec(body)?.[0]?.toLowerCase() ?? null;
    }
    for (const candidate of body.match(PHONE_CANDIDATE_RE) ?? []) {
      const normalized = normalizePhone(candidate);
      if (!normalized) continue;
      if (normalized === excluded) continue;
      if (!mentionedPhones.includes(normalized)) {
        mentionedPhones.push(normalized);
      }
    }
  }

  // An address-style email is a weaker signal than an introduction, so it only
  // fills in a name nothing else supplied.
  if (!name && email) {
    name = nameFromEmail(email);
  }

  return {
    firstName: name?.firstName ?? null,
    lastName: name?.lastName ?? null,
    email,
    mentionedPhones,
  };
}
