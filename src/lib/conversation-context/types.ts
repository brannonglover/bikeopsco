/**
 * The normalized picture of a customer that a conversation adds up to.
 *
 * Staff actions taken from the inbox — "Create contact" today, "Create job"
 * next — all need the same things: who this is, what they ride, what they want
 * done and when. Each of those used to be worked out by whichever screen
 * needed it, so two screens reading the same thread could disagree. This layer
 * is the one place that reads a conversation, and everything downstream
 * consumes what it returns.
 *
 * Every value arrives tagged with the layer it came from, because staff are
 * confirming these fields rather than accepting them: "we read this out of
 * their text" and "this was already on file" deserve different treatment in
 * the UI, and a wrong value is much easier to trace when its origin travels
 * with it.
 *
 * What this describes is the conversation, not any particular thing built from
 * it. The shapes below deliberately do not match `createBookingJob`'s input
 * even where they overlap heavily: a job has a `bikeType` and a drop-off date,
 * while a conversation has "it's an e-bike" and "I could come Saturday". Each
 * consumer maps what it needs at the point of use. Shaping this to the job API
 * instead would mean quietly discarding everything the job API has no column
 * for — and a detail never captured cannot be recovered later when there is
 * somewhere to put it.
 */

import type { ServiceMatch } from "./service-matching";

/** Where a single value came from. Ordered strongest first. */
export type ContextSource =
  /**
   * Read out of the conversation itself by a deterministic extractor — the
   * customer's own words, or the number their text arrived from. No model is
   * involved, so these are the values we are most confident in.
   */
  | "conversation"
  /**
   * Collected by the AI assistant while it was handling the thread, and
   * written back to the customer record. Conversation-derived too, but through
   * a model's reading of it rather than a rule.
   */
  | "ai_collected"
  /** Already on file for this customer before the conversation started. */
  | "customer_record";

/** A resolved value and the layer it came from. Null when no layer had one. */
export type ContextField<T> = { value: T; source: ContextSource } | null;

/** Who the shop is talking to. */
export type CustomerIdentityContext = {
  firstName: ContextField<string>;
  lastName: ContextField<string>;
  email: ContextField<string>;
  phone: ContextField<string>;
  address: ContextField<string>;
  notes: ContextField<string>;
  /**
   * Numbers named in the thread that differ from the one they texted from, in
   * the order they were mentioned. Offered as alternatives rather than
   * resolved into `phone`, which is the number replies actually go to.
   */
  mentionedPhones: string[];
};

/**
 * One bike, as the conversation described it.
 *
 * `electric` is what the customer said about it rather than a `BikeType` — a
 * consumer that needs one derives it, the same way the rest of the app already
 * infers regular vs e-bike from a make and model when no one has said.
 */
export type BikeContext = {
  make: ContextField<string>;
  model: ContextField<string>;
  year: ContextField<number>;
  electric: ContextField<boolean>;
  /** How they referred to it: "my commuter", "the kid's bike". */
  describedAs: ContextField<string>;
  /**
   * Set when this has been matched to a bike already on the customer's
   * profile. Nothing matches yet; the customer's own bikes join as a
   * `customer_record` layer with "Create job".
   */
  customerBikeId: string | null;
};

/**
 * What they told the shop about the work, kept in separate lists on purpose.
 *
 * A symptom is what the bike is doing, a suspicion is the customer's guess at
 * why, and a requested service is work they actually asked for. "It's skipping
 * under load, I think the chain is worn, and can you check the brakes" is all
 * three at once, and flattening them would turn a guess into a work order.
 * Only `requestedServices` is anything the shop has been asked to do.
 */
export type ServiceRequestContext = {
  symptoms: ContextField<string[]>;
  customerSuspicions: ContextField<string[]>;
  requestedServices: ContextField<string[]>;
  /**
   * Shop service ids the requests confidently resolve to. Empty until a caller
   * supplies the shop's service list, since nothing here knows what the shop
   * sells; matching belongs in this layer rather than in the job screen so a
   * second screen cannot match the same sentence differently.
   */
  serviceIds: ContextField<string[]>;
  /**
   * Every request paired with the closest thing the shop sells, including the
   * ones that matched weakly or not at all — offered alongside the resolved
   * ids the way `mentionedPhones` sits alongside `phone`. A consumer showing
   * staff their options needs the near misses; `serviceIds` alone would hide
   * them.
   */
  serviceMatches: ServiceMatch[];
};

/** What they said about getting the bike to the shop. */
export type SchedulingContext = {
  /** In their own words: "Saturday morning", "after work this week". */
  availability: ContextField<string[]>;
};

export type ConversationContext = {
  conversationId: string;
  customerId: string;
  identity: CustomerIdentityContext;
  /**
   * Populated from what the assistant collected. No deterministic extractor
   * reads bikes or symptoms out of the raw text yet, and the customer's own
   * bikes are not matched in — both join as further layers without changing
   * anything downstream, which is the point of resolving field by field.
   */
  bikes: BikeContext[];
  service: ServiceRequestContext;
  scheduling: SchedulingContext;
};
