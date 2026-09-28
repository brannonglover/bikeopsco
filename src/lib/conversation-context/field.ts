import type { ContextField, ContextSource } from "./types";

/**
 * Merging layered answers into one field.
 *
 * Every field in the context is resolved the same way: ask each layer in turn,
 * take the first that has something. Doing it field by field rather than
 * layer by layer is the point — a thread that gives up a first name and a
 * record that holds the surname should produce the whole name, which an
 * all-or-nothing fallback cannot.
 */

/** A layer's answer for one field, tagged with which layer it is. */
export type Candidate<T> = readonly [ContextSource, T | null | undefined];

/**
 * Whether a layer actually supplied something.
 *
 * Blank strings and empty arrays mean "this layer had nothing", not "this
 * layer says it is empty" — they come from untouched form fields and from
 * extractors that found no matches, and treating them as answers would stop a
 * weaker layer from filling the gap.
 */
function present<T>(raw: T | null | undefined): raw is T {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (Array.isArray(raw)) return raw.length > 0;
  return true;
}

function clean<T>(raw: T): T {
  return typeof raw === "string" ? (raw.trim() as T) : raw;
}

/** First layer with an answer wins; the result remembers which one that was. */
export function resolveField<T>(
  ...candidates: Array<Candidate<T>>
): ContextField<T> {
  for (const [source, raw] of candidates) {
    if (!present(raw)) continue;
    return { value: clean(raw), source };
  }
  return null;
}

export function valueOf<T>(field: ContextField<T>): T | null {
  return field ? field.value : null;
}

export function sourceOf<T>(field: ContextField<T>): ContextSource | null {
  return field ? field.source : null;
}

/** True when the field was filled from the conversation, by rule or by model. */
export function isFromConversation<T>(field: ContextField<T>): boolean {
  return field !== null && field.source !== "customer_record";
}
