/**
 * Matching what a customer asked for against what the shop actually sells.
 *
 * The collection keeps a request in the customer's own words — "can you check
 * the brakes" — because that is what they said, and a phrase is not a line
 * item. Turning it into one is the shop's decision, and it belongs here rather
 * than in the screen that happens to need it first: "Create job" matches
 * today, a quote or a reminder may match tomorrow, and two screens that match
 * the same sentence differently is the class of bug this whole layer exists to
 * prevent.
 *
 * Nothing here decides anything on its own. A match is a suggestion carrying
 * how sure it is, and only a `strong` one is worth putting in front of staff
 * pre-selected. A request that matches nothing is not a failure — plenty of
 * real requests ("can you look at the creaking") have no line item, and they
 * survive as notes on the job instead.
 */

/** A service the shop sells, as much of it as matching needs. */
export type ServiceOption = { id: string; name: string };

export type MatchConfidence = "strong" | "weak" | "none";

export type ServiceMatch = {
  /** The request in the customer's words, exactly as collected. */
  requested: string;
  serviceId: string | null;
  serviceName: string | null;
  /**
   * `strong` — every distinctive word in the service's name was asked for.
   * `weak` — some overlap, or more than one service fits equally well.
   * `none` — nothing the shop sells resembles this.
   */
  confidence: MatchConfidence;
};

/** Grammar. Carries no meaning on either side of the comparison. */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "my", "our", "your", "it", "its", "is", "are", "be",
  "been", "to", "for", "on", "in", "of", "at", "with", "that", "this", "if",
  "or", "but", "so", "as", "i", "we", "you", "me", "please", "thanks", "also",
  "some", "any", "there", "here", "just", "would", "could", "can", "will",
  "do", "does", "did", "have", "has", "had", "am", "was", "were",
]);

/**
 * Words that appear in almost every request and almost every service name.
 *
 * Dropping these from both sides is what makes the comparison work: "can you
 * check the brakes" and "Brake adjustment" both reduce to `brake`, and match
 * exactly, while "check" on its own can no longer drag a request toward an
 * unrelated service that happens to be called a check.
 */
const GENERIC = new Set([
  "check", "checked", "checking", "look", "looked", "looking", "see", "sort",
  "sorted", "out", "over", "fix", "fixed", "fixing", "repair", "repaired",
  "repairing", "service", "serviced", "servicing", "adjust", "adjusted",
  "adjusting", "adjustment", "replace", "replaced", "replacing",
  "replacement", "new", "need", "needed", "needs", "want", "wanted", "get",
  "got", "take", "taken", "give", "done", "work", "job", "bike", "bicycle",
  "cycle", "full", "general", "complete", "standard", "basic", "quick",
]);

/**
 * "brakes" and "brake" are the same request.
 *
 * Deliberately shallow — it handles the plurals bike parts actually come in
 * and leaves everything else alone. An over-eager stemmer would collapse
 * "truing" and "true", which are different words on a price list.
 */
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (
    word.length > 4 &&
    (word.endsWith("ches") || word.endsWith("shes") || word.endsWith("sses") ||
      word.endsWith("xes"))
  ) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(singularize)
    .filter((word) => !STOPWORDS.has(word));
}

/**
 * The words worth comparing, and whether anything distinctive was left.
 *
 * A service whose name is nothing but generic words — "General service", "Full
 * service" — would reduce to nothing and match every request ever made, so it
 * keeps its own words instead and reports that it had to. A request is then
 * compared against it on the same terms: the generic words the request would
 * normally shed are exactly the ones such a name is made of, and dropping them
 * from only one side means "I would like a general service" can never reach
 * the service called General service.
 */
function tokenize(text: string): { tokens: Set<string>; generic: boolean } {
  const all = words(text);
  const content = all.filter((word) => !GENERIC.has(word));
  return content.length > 0
    ? { tokens: new Set(content), generic: false }
    : { tokens: new Set(all), generic: true };
}

const NO_MATCH = { serviceId: null, serviceName: null, confidence: "none" as const };

/** Matches one request against the shop's list. */
function matchOne(requested: string, services: ServiceOption[]): ServiceMatch {
  const asked = tokenize(requested);
  // Everything the request said, generic words included. Only ever compared
  // against a service whose name is itself nothing but generic words.
  const askedAll = new Set(words(requested));
  if (asked.tokens.size === 0) return { requested, ...NO_MATCH };

  let best: { service: ServiceOption; ratio: number; overlap: number } | null =
    null;
  let bestIsShared = false;

  for (const service of services) {
    const offered = tokenize(service.name);
    if (offered.tokens.size === 0) continue;
    const against = offered.generic ? askedAll : asked.tokens;

    let overlap = 0;
    for (const token of offered.tokens) if (against.has(token)) overlap += 1;
    if (overlap === 0) continue;

    const ratio = overlap / offered.tokens.size;
    if (!best || ratio > best.ratio || (ratio === best.ratio && overlap > best.overlap)) {
      best = { service, ratio, overlap };
      bestIsShared = false;
    } else if (ratio === best.ratio && overlap === best.overlap) {
      // Two services fit this request equally well. Neither is the answer.
      bestIsShared = true;
    }
  }

  if (!best) return { requested, ...NO_MATCH };

  return {
    requested,
    serviceId: best.service.id,
    serviceName: best.service.name,
    // A tie is reported as the uncertainty it is: the request is offered to
    // staff with a service attached, but not pre-selected on our say-so.
    confidence: best.ratio === 1 && !bestIsShared ? "strong" : "weak",
  };
}

/** Every collected request, each with the closest thing the shop sells. */
export function matchRequestedServices(
  requested: string[],
  services: ServiceOption[]
): ServiceMatch[] {
  if (services.length === 0) {
    return requested.map((text) => ({ requested: text, ...NO_MATCH }));
  }
  return requested.map((text) => matchOne(text, services));
}

/**
 * The service ids confident enough to put in front of staff already ticked.
 *
 * Weak matches are deliberately left out. They still reach the screen beside
 * the request that produced them, where staff can tick them; what they do not
 * do is arrive pre-selected, because a wrong line item that nobody unticked is
 * a wrong invoice.
 */
export function confidentServiceIds(matches: ServiceMatch[]): string[] {
  const ids: string[] = [];
  for (const match of matches) {
    if (match.confidence !== "strong" || !match.serviceId) continue;
    if (!ids.includes(match.serviceId)) ids.push(match.serviceId);
  }
  return ids;
}
