import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  backoffMs,
  classifyLookupError,
  LookupDeadlineError,
  LookupResultError,
} from "./errors";

describe("classifyLookupError", () => {
  it("retries a rate limit no sooner than Retry-After asks", () => {
    const err = new Anthropic.RateLimitError(429, {}, "rate limited", new Headers({ "retry-after": "120" }));
    const kind = classifyLookupError(err);
    assert.equal(kind.retryable, true);
    assert.equal(kind.mayHaveBilled, false);
    assert.equal(kind.retryAfterMs, 120_000);
  });

  it("retries server errors and overload", () => {
    assert.equal(classifyLookupError(new Anthropic.InternalServerError(500, {}, "boom", new Headers())).retryable, true);
    assert.equal(classifyLookupError(Anthropic.APIError.generate(529, {}, "overloaded", new Headers())).retryable, true);
  });

  it("treats a timeout as retryable and possibly billed", () => {
    const kind = classifyLookupError(new Anthropic.APIConnectionTimeoutError());
    assert.deepEqual(kind, { retryable: true, mayHaveBilled: true, retryAfterMs: null });
  });

  it("treats an abort (our deadline) as retryable and possibly billed", () => {
    const kind = classifyLookupError(new Anthropic.APIUserAbortError());
    assert.equal(kind.retryable, true);
    assert.equal(kind.mayHaveBilled, true);
  });

  it("never retries requests that can't succeed", () => {
    assert.equal(classifyLookupError(new Anthropic.BadRequestError(400, {}, "bad", new Headers())).retryable, false);
    assert.equal(classifyLookupError(new Anthropic.AuthenticationError(401, {}, "auth", new Headers())).retryable, false);
    assert.equal(classifyLookupError(new LookupResultError("refused", false)).retryable, false);
  });

  it("retries our own deadline and unparseable output", () => {
    assert.equal(classifyLookupError(new LookupDeadlineError()).retryable, true);
    assert.equal(classifyLookupError(new LookupResultError("no output", true)).retryable, true);
  });

  it("retries unknown errors (e.g. a dropped DB connection)", () => {
    assert.equal(classifyLookupError(new Error("Can't reach database")).retryable, true);
  });
});

describe("backoffMs", () => {
  it("waits longer after each failure, then holds at a day", () => {
    const waits = [1, 2, 3, 4, 5, 9].map(backoffMs);
    assert.deepEqual(waits, [15 * 60_000, 60 * 60_000, 6 * 3_600_000, 24 * 3_600_000, 24 * 3_600_000, 24 * 3_600_000]);
  });
});
