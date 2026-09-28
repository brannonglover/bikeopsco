import {
  extractContactFromMessages,
  type ContactExtractionMessage,
} from "./identity-extraction";
import type { CollectedContext, CollectedIdentity } from "./ai-collected";
import { resolveField, valueOf } from "./field";
import type { CustomerIdentityContext } from "./types";

/** The customer columns the identity layer reads. */
export const IDENTITY_CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
  notes: true,
  provisional: true,
} as const;

export type IdentityCustomerRecord = {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  provisional: boolean;
};

const NO_COLLECTED_IDENTITY: CollectedIdentity = {
  firstName: null,
  lastName: null,
  email: null,
};

/**
 * A name that is really the stand-in label for a number.
 *
 * A contact auto-created to hold a text from a stranger is named with the
 * formatted number, so its `firstName` must never reach a form as a name. No
 * real first name is made only of digits and phone punctuation, which catches
 * the label whichever formatting it was written in.
 */
const PHONE_SHAPED_NAME_RE = /^[+(]?\d[\d\s().+-]*$/;

function realName(firstName: string): string | null {
  const trimmed = firstName.trim();
  if (!trimmed || PHONE_SHAPED_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * What the assistant collected, for a thread it handled before its collection
 * was being stored.
 *
 * Those threads have the assistant's work flattened onto the customer row and
 * no record of it anywhere else. The one case that can still be read back with
 * confidence is a contact the assistant named and staff have not confirmed:
 * nobody else has touched it, so its name and email are the assistant's. That
 * is the old inference, now confined to the rows it is actually true of and
 * deletable once those threads have been worked through — every conversation
 * the assistant handles from here on stores the real thing.
 */
function collectedIdentityBefore(
  customer: IdentityCustomerRecord
): CollectedIdentity {
  if (!customer.provisional) return NO_COLLECTED_IDENTITY;
  return {
    firstName: realName(customer.firstName),
    lastName: customer.lastName,
    email: customer.email,
  };
}

/**
 * Whether a layer's surname can be used alongside the first name we settled on.
 *
 * Threads name other people — "my wife Sarah is dropping it off" — and a layer
 * that believes the customer is Roger has nothing to say about Sarah's
 * surname. A layer that offers a surname without a first name is not
 * contradicting anything, so it is allowed through.
 */
function surnameFor(
  chosenFirstName: string | null,
  layer: { firstName: string | null; lastName: string | null }
): string | null {
  if (!layer.lastName) return null;
  if (!layer.firstName || !chosenFirstName) return layer.lastName;
  return layer.firstName.toLowerCase() === chosenFirstName.toLowerCase()
    ? layer.lastName
    : null;
}

/**
 * Resolves who the shop is talking to, field by field.
 *
 * Three layers, strongest first: what the thread's own words give up by rule,
 * what the assistant collected while it was handling the thread, and what was
 * already on the customer's file. Resolving each field separately is what
 * makes a first name read out of the text and a surname the assistant
 * collected add up to a whole name — the form used to take the extractor's
 * answer or the record's, never both.
 */
export function buildCustomerIdentityContext({
  messages,
  customer,
  collected,
}: {
  messages: ContactExtractionMessage[];
  customer: IdentityCustomerRecord;
  collected: CollectedContext | null;
}): CustomerIdentityContext {
  const extracted = extractContactFromMessages(messages, {
    excludePhone: customer.phone,
  });
  const ai = collected?.identity ?? collectedIdentityBefore(customer);
  const storedFirstName = realName(customer.firstName);

  const firstName = resolveField<string>(
    ["conversation", extracted.firstName],
    ["ai_collected", ai.firstName],
    ["customer_record", storedFirstName]
  );
  const chosenFirstName = valueOf(firstName);

  return {
    firstName,
    lastName: resolveField<string>(
      ["conversation", surnameFor(chosenFirstName, extracted)],
      ["ai_collected", surnameFor(chosenFirstName, ai)],
      [
        "customer_record",
        surnameFor(chosenFirstName, {
          firstName: storedFirstName,
          lastName: customer.lastName,
        }),
      ]
    ),
    email: resolveField<string>(
      ["conversation", extracted.email],
      ["ai_collected", ai.email],
      ["customer_record", customer.email]
    ),
    // The number a provisional contact holds is the one their text arrived
    // from, which is the conversation itself rather than anything on file.
    phone: resolveField<string>([
      customer.provisional ? "conversation" : "customer_record",
      customer.phone,
    ]),
    address: resolveField<string>(["customer_record", customer.address]),
    notes: resolveField<string>(["customer_record", customer.notes]),
    mentionedPhones: extracted.mentionedPhones,
  };
}

/**
 * The flat shape the inbox's "Create contact" form has always been sent.
 *
 * Kept because staff apps already in the field read it, and they get the
 * merged values through it without needing an update. New callers should read
 * the context instead, where each value still carries where it came from.
 */
export function toContactSuggestion(identity: CustomerIdentityContext): {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mentionedPhones: string[];
} {
  return {
    firstName: valueOf(identity.firstName),
    lastName: valueOf(identity.lastName),
    email: valueOf(identity.email),
    mentionedPhones: identity.mentionedPhones,
  };
}
