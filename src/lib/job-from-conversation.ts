/**
 * Turning what a conversation said into a draft job.
 *
 * This is the mapping the conversation context deliberately does not do. The
 * context describes what the customer told the shop; a job is a thing with a
 * bike type, line items and a drop-off date. Every lossy decision between the
 * two lives here, at the point of use, so that adding a column to the job
 * never quietly changes what the context is allowed to remember.
 *
 * Three rules shape the whole file, and they are the point of it:
 *
 *  - A symptom is not a diagnosis and a suspicion is not a work order. Both
 *    reach the job as notes, attributed to the customer, and neither becomes a
 *    line item. "I think the chain is worn" must never bill a chain.
 *  - "Friday around lunchtime" is not a date. It is carried across as text for
 *    staff to read; the drop-off date stays empty until a person sets one.
 *  - Nothing the customer said is dropped for lack of a column. A request the
 *    shop has no service for still arrives, as a note.
 *
 * It runs on the client, because the review screen builds its initial state
 * from it and the server validates what staff actually confirmed.
 */
import type { ServiceMatch } from "./conversation-context/service-matching";
import type {
  BikeContext,
  ConversationContext,
} from "./conversation-context/types";
import { valueOf } from "./conversation-context/field";

/**
 * The parts of a conversation a job is built from.
 *
 * Narrower than the whole context on purpose: a job is not made out of who the
 * customer is — that is already settled by the time this runs — and asking for
 * the full shape would force callers to invent the fields it does not read.
 */
export type JobSource = Pick<
  ConversationContext,
  "bikes" | "service" | "scheduling"
>;

export type JobDraftBike = {
  make: string;
  model: string;
  /** Null when nobody said, which the job reads as "infer it from the make". */
  bikeType: "REGULAR" | "E_BIKE" | null;
  /** Their own words for it, shown beside the fields but never written as one. */
  describedAs: string | null;
};

export type JobDraft = {
  bikes: JobDraftBike[];
  /** Only the confident matches arrive ticked. */
  serviceIds: string[];
  customerNotes: string;
  /** Kept separate from the notes so the screen can show it as its own line. */
  availability: string[];
};

/**
 * What the customer said about the bike, as job fields.
 *
 * `electric` becomes a `BikeType` only when they actually said something. Left
 * null otherwise — the job infers regular vs e-bike from the make and model
 * later, and guessing here would record that guess as though someone had told
 * us.
 */
function toDraftBike(bike: BikeContext): JobDraftBike {
  const electric = valueOf(bike.electric);
  return {
    make: valueOf(bike.make) ?? "",
    model: valueOf(bike.model) ?? "",
    bikeType: electric === null ? null : electric ? "E_BIKE" : "REGULAR",
    describedAs: valueOf(bike.describedAs),
  };
}

/** Requests that no service confidently covers, so they are not lost. */
export function unmatchedRequests(matches: ServiceMatch[]): string[] {
  return matches
    .filter((match) => match.confidence !== "strong")
    .map((match) => match.requested);
}

/**
 * The notes that travel with the job, in the customer's voice.
 *
 * Every line says who it came from. Staff reading "Customer suspects: chain
 * may be worn" on a job card know they are reading a guess made by someone who
 * was not looking at the bike — which is exactly the distinction that
 * disappears when these lists get flattened into one description.
 */
export function buildJobNotes(context: JobSource): string {
  const { service, scheduling } = context;
  const lines: string[] = [];

  const symptoms = valueOf(service.symptoms) ?? [];
  if (symptoms.length > 0) lines.push(`Customer reports: ${symptoms.join("; ")}`);

  const suspicions = valueOf(service.customerSuspicions) ?? [];
  if (suspicions.length > 0) {
    lines.push(`Customer suspects: ${suspicions.join("; ")}`);
  }

  // Requests that did become line items are on the job already; repeating them
  // here would read as a second, separate ask.
  const leftover = unmatchedRequests(service.serviceMatches);
  if (leftover.length > 0) lines.push(`Also asked for: ${leftover.join("; ")}`);

  const availability = valueOf(scheduling.availability) ?? [];
  if (availability.length > 0) {
    lines.push(`Availability given: ${availability.join("; ")}`);
  }

  return lines.join("\n");
}

/** The starting point for the review screen. Staff change it before it saves. */
export function buildJobDraft(context: JobSource): JobDraft {
  return {
    bikes: context.bikes.map(toDraftBike),
    serviceIds: valueOf(context.service.serviceIds) ?? [],
    customerNotes: buildJobNotes(context),
    availability: valueOf(context.scheduling.availability) ?? [],
  };
}
