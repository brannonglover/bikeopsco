import Anthropic from "@anthropic-ai/sdk";

/** The lookup ran out of its time budget before the search finished. */
export class LookupDeadlineError extends Error {
  constructor() {
    super("Lookup ran out of time before the search finished");
    this.name = "LookupDeadlineError";
  }
}

/** Today's lookup budget is spent; nothing new may be paid for until tomorrow (UTC). */
export class LookupBudgetError extends Error {
  constructor(spentUsd: number, budgetUsd: number) {
    super(`Daily lookup budget reached ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)})`);
    this.name = "LookupBudgetError";
  }
}

/** The model answered, but not with something we can use (refusal, bad output). */
export class LookupResultError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "LookupResultError";
  }
}

export type LookupErrorKind = {
  retryable: boolean;
  /** The server may have done (and billed) work before the call failed. */
  mayHaveBilled: boolean;
  /** Server asked us to wait at least this long (Retry-After). */
  retryAfterMs: number | null;
};

function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Which failures are worth paying to retry, and which never will succeed. */
export function classifyLookupError(error: unknown): LookupErrorKind {
  if (error instanceof LookupDeadlineError) {
    return { retryable: true, mayHaveBilled: false, retryAfterMs: null };
  }
  if (error instanceof LookupResultError) {
    return { retryable: error.retryable, mayHaveBilled: false, retryAfterMs: null };
  }
  // Order matters: the timeout and abort errors are subclasses of the
  // connection error, and every SDK error extends APIError.
  if (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    // The request may have reached the server and run before we gave up on it.
    return { retryable: true, mayHaveBilled: true, retryAfterMs: null };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { retryable: true, mayHaveBilled: false, retryAfterMs: retryAfterMs(error.headers) };
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const retryable = status === 408 || status === 409 || status === 529 || status >= 500;
    return {
      retryable,
      mayHaveBilled: false,
      retryAfterMs: retryable ? retryAfterMs(error.headers ?? undefined) : null,
    };
  }
  // Anything else (a dropped DB connection, a bug) — worth another try later.
  return { retryable: true, mayHaveBilled: false, retryAfterMs: null };
}

const BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** Wait before retry number `attempt` (1-based): 15 min, 1 h, 6 h, then daily. */
export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1];
}
