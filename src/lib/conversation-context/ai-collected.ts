/**
 * What the AI assistant collected from a conversation, as stored.
 *
 * The assistant reads a thread far better than any rule here can, and until
 * this existed the only durable trace of that reading was the handful of
 * values it copied onto the customer row plus one prose line of summary.
 * Everything else — the bike someone described, the noise they reported, the
 * part they suspect — was gone by the time staff acted on the thread, and even
 * the values that survived arrived indistinguishable from details the shop had
 * on file for years.
 *
 * So the assistant's reading is persisted whole, on the conversation it came
 * from, and this is the shape of it. It lives with the context layer rather
 * than with the assistant because it is a layer of the context: the assistant
 * writes this shape, the context reads it, and neither needs to know the
 * other's internals.
 *
 * It is stored in a JSON column, which means rows written by older code will
 * turn up here — `parseCollectedContext` therefore trusts nothing and every
 * field is optional in practice. The assistant's own output goes through the
 * same reader on its way in, so a model that returns a 400-word "first name"
 * or an unparseable email is caught in one place rather than two.
 */

/** Bumped when the stored shape changes in a way readers must notice. */
export const COLLECTED_CONTEXT_VERSION = 1;

export type CollectedIdentity = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

/**
 * A bike as the customer described it — not as the shop would record it.
 *
 * `electric` is what they said about it, which a consumer maps to a `BikeType`
 * if it needs one; nothing here decides that a "Trek Fuel EX 8" is a mountain
 * bike, because the customer did not say so.
 */
export type CollectedBike = {
  make: string | null;
  model: string | null;
  year: number | null;
  electric: boolean | null;
  /** How they referred to it: "my commuter", "the kid's bike". */
  describedAs: string | null;
};

/**
 * What they want done, kept in three separate lists on purpose.
 *
 * A symptom is what the bike is doing, a suspicion is the customer's own guess
 * at why, and a requested service is work they have actually asked for. They
 * arrive in one breath — "it's skipping under load, I think the chain is worn,
 * and can you check the brakes" — and collapsing them turns a guess into a
 * work order and a symptom into a diagnosis. Only the third is anything the
 * shop has been asked to do.
 */
export type CollectedService = {
  symptoms: string[];
  customerSuspicions: string[];
  requestedServices: string[];
};

export type CollectedScheduling = {
  /** When they said they could come by, in their words: "Saturday morning". */
  availability: string[];
};

export type CollectedContext = {
  version: number;
  identity: CollectedIdentity;
  bikes: CollectedBike[];
  service: CollectedService;
  scheduling: CollectedScheduling;
};

export const EMPTY_COLLECTED_CONTEXT: CollectedContext = {
  version: COLLECTED_CONTEXT_VERSION,
  identity: { firstName: null, lastName: null, email: null },
  bikes: [],
  service: { symptoms: [], customerSuspicions: [], requestedServices: [] },
  scheduling: { availability: [] },
};

const MAX_LIST_ITEMS = 10;
const MAX_BIKES = 5;
const MAX_TEXT_LENGTH = 200;
/** A "name" this long is the model narrating rather than reporting a name. */
const MAX_NAME_LENGTH = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

function asName(value: unknown): string | null {
  const text = asText(value);
  return text && text.length <= MAX_NAME_LENGTH ? text : null;
}

function asEmail(value: unknown): string | null {
  const text = asText(value);
  return text && EMAIL_RE.test(text) ? text.toLowerCase() : null;
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const text = asText(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function asYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  // A bike year outside this range is the model having misread something.
  return value >= 1900 && value <= 2100 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asBike(value: unknown): CollectedBike | null {
  const raw = asRecord(value);
  const bike: CollectedBike = {
    make: asText(raw.make),
    model: asText(raw.model),
    year: asYear(raw.year),
    electric: asBoolean(raw.electric),
    describedAs: asText(raw.describedAs),
  };
  // A bike nothing is known about is not a bike.
  const known = bike.make ?? bike.model ?? bike.describedAs;
  return known ? bike : null;
}

/**
 * Reads the JSON column back into the shape above.
 *
 * Returns null for a conversation the assistant never handled. Anything
 * unrecognized inside a row that is there is dropped rather than rejected: a
 * stored bike that has lost its make is still worth the symptoms beside it.
 */
export function parseCollectedContext(value: unknown): CollectedContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = asRecord(value);
  const identity = asRecord(raw.identity);
  const service = asRecord(raw.service);
  const scheduling = asRecord(raw.scheduling);

  return {
    version:
      typeof raw.version === "number" ? raw.version : COLLECTED_CONTEXT_VERSION,
    identity: {
      firstName: asName(identity.firstName),
      lastName: asName(identity.lastName),
      email: asEmail(identity.email),
    },
    bikes: Array.isArray(raw.bikes)
      ? (raw.bikes
          .map(asBike)
          .filter(Boolean) as CollectedBike[]).slice(0, MAX_BIKES)
      : [],
    service: {
      symptoms: asTextList(service.symptoms),
      customerSuspicions: asTextList(service.customerSuspicions),
      requestedServices: asTextList(service.requestedServices),
    },
    scheduling: { availability: asTextList(scheduling.availability) },
  };
}

/** Keeps `incoming` where it said something, `previous` where it did not. */
function keepList(previous: string[], incoming: string[]): string[] {
  return incoming.length > 0 ? incoming : previous;
}

/**
 * Folds a turn's collection into what the conversation already held.
 *
 * The assistant re-reads the whole thread every turn, so what it returns is a
 * complete answer rather than a delta and is taken over what came before — a
 * customer correcting themselves ("sorry, the Fuel EX 9") has to be able to
 * win. The exception is silence: a turn that reports nothing for a field is a
 * turn that had nothing to say about it, most often because it was busy
 * answering something else, and that must not erase what an earlier turn
 * learned.
 *
 * The cost of that exception is retraction: a customer who takes something
 * back ("actually the chain is fine") produces an empty list, which reads here
 * as silence, so the old entry stays. Keeping a withdrawn suspicion is the
 * better of the two mistakes — it is labelled as the customer's guess, and
 * staff confirm everything before it reaches a job — while the alternative
 * loses a bike described three messages ago to any turn that happens to be
 * about something else.
 */
export function mergeCollectedContext(
  previous: CollectedContext | null,
  incoming: CollectedContext
): CollectedContext {
  if (!previous) return incoming;
  return {
    version: COLLECTED_CONTEXT_VERSION,
    identity: {
      firstName: incoming.identity.firstName ?? previous.identity.firstName,
      lastName: incoming.identity.lastName ?? previous.identity.lastName,
      email: incoming.identity.email ?? previous.identity.email,
    },
    bikes: incoming.bikes.length > 0 ? incoming.bikes : previous.bikes,
    service: {
      symptoms: keepList(previous.service.symptoms, incoming.service.symptoms),
      customerSuspicions: keepList(
        previous.service.customerSuspicions,
        incoming.service.customerSuspicions
      ),
      requestedServices: keepList(
        previous.service.requestedServices,
        incoming.service.requestedServices
      ),
    },
    scheduling: {
      availability: keepList(
        previous.scheduling.availability,
        incoming.scheduling.availability
      ),
    },
  };
}
