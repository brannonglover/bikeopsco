import "server-only";

import { prisma } from "@/lib/db";
import { parseCollectedContext, type CollectedBike } from "./ai-collected";
import {
  buildCustomerIdentityContext,
  IDENTITY_CUSTOMER_SELECT,
  type IdentityCustomerRecord,
} from "./customer-identity";
import { resolveField } from "./field";
import {
  confidentServiceIds,
  matchRequestedServices,
  type ServiceOption,
} from "./service-matching";
import type { BikeContext, ConversationContext } from "./types";

export * from "./ai-collected";
export {
  buildCustomerIdentityContext,
  toContactSuggestion,
} from "./customer-identity";
export { isFromConversation, resolveField, sourceOf, valueOf } from "./field";
export * from "./service-matching";
export * from "./types";

/**
 * The customer columns every context layer between them reads. Callers select
 * these so the context can be built without a second query for the same row.
 */
export const CONTEXT_CUSTOMER_SELECT = IDENTITY_CUSTOMER_SELECT;

/**
 * Bounds how much history the extractors read. People introduce themselves and
 * describe the problem in their opening texts, so the oldest messages are the
 * ones that matter.
 */
const SCAN_MESSAGE_LIMIT = 100;

/** A bike the assistant collected, as a field-by-field context entry. */
function toBikeContext(bike: CollectedBike): BikeContext {
  return {
    make: resolveField<string>(["ai_collected", bike.make]),
    model: resolveField<string>(["ai_collected", bike.model]),
    year: resolveField<number>(["ai_collected", bike.year]),
    electric: resolveField<boolean>(["ai_collected", bike.electric]),
    describedAs: resolveField<string>(["ai_collected", bike.describedAs]),
    customerBikeId: null,
  };
}

/**
 * Reads everything a conversation has to say about the customer, their bikes,
 * what they want done and when.
 *
 * Two sources feed it: the thread's own text, read by rule, and what the AI
 * assistant collected while it was handling the thread, stored on the
 * conversation as it went. The customer's file fills whatever neither
 * supplied. Adding a source later — a bike extractor, the customer's own bikes
 * — is a new layer in the merge rather than a new pipeline, and nothing
 * downstream changes.
 *
 * Callers pass the customer row they have already loaded and authorized, which
 * keeps every "is this thread mine to read?" decision in the route where it
 * belongs — this only reads.
 */
export async function buildConversationContext({
  conversationId,
  customer,
  services = [],
}: {
  conversationId: string;
  customer: { id: string } & IdentityCustomerRecord;
  /**
   * What the shop sells, when the caller needs requests resolved to line
   * items. Omitted by callers that only want to know what was said — nothing
   * here can match without it, and an empty list yields no matches rather than
   * a wrong one.
   */
  services?: ServiceOption[];
}): Promise<ConversationContext> {
  const [conversation, messages] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { aiCollectedContext: true },
    }),
    // Both sides of the thread. The extractors decide for themselves what they
    // will read from a shop message — a salutation, and whether the shop had
    // just asked the customer a question — and filtering to CUSTOMER here left
    // them blind to both.
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: SCAN_MESSAGE_LIMIT,
      select: { sender: true, body: true },
    }),
  ]);

  const collected = parseCollectedContext(conversation?.aiCollectedContext);
  const requestedServices = collected?.service.requestedServices ?? [];
  const serviceMatches = matchRequestedServices(requestedServices, services);
  const matchedIds = confidentServiceIds(serviceMatches);

  return {
    conversationId,
    customerId: customer.id,
    identity: buildCustomerIdentityContext({ messages, customer, collected }),
    bikes: (collected?.bikes ?? []).map(toBikeContext),
    service: {
      symptoms: resolveField<string[]>([
        "ai_collected",
        collected?.service.symptoms,
      ]),
      customerSuspicions: resolveField<string[]>([
        "ai_collected",
        collected?.service.customerSuspicions,
      ]),
      requestedServices: resolveField<string[]>([
        "ai_collected",
        requestedServices,
      ]),
      // Only the confident matches. A request the shop has no line item for is
      // not lost — it stays in `serviceMatches` and in `requestedServices`,
      // and reaches the job as a note instead.
      serviceIds: resolveField<string[]>(["ai_collected", matchedIds]),
      serviceMatches,
    },
    scheduling: {
      availability: resolveField<string[]>([
        "ai_collected",
        collected?.scheduling.availability,
      ]),
    },
  };
}
