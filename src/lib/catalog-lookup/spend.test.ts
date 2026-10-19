import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  costOfCall,
  dailyBudgetUsd,
  DEFAULT_DAILY_BUDGET_USD,
  nextUtcMidnight,
  startOfUtcDay,
  summarizeSpend,
} from "./spend";

describe("costOfCall", () => {
  it("prices Opus 5.5 tokens and web searches", () => {
    const cost = costOfCall("claude-opus-5-5", {
      input_tokens: 100_000,
      output_tokens: 10_000,
      cache_read_input_tokens: 50_000,
      cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: 4, web_fetch_requests: 2 },
    });
    // 0.1M × $4 + 0.01M × $20 + 0.05M × $0.20 + 4 × $0.01
    assert.ok(Math.abs(cost.costUsd - (0.4 + 0.2 + 0.01 + 0.04)) < 1e-9);
    assert.equal(cost.webSearches, 4);
    assert.equal(cost.webFetches, 2);
  });

  it("prices an unknown model at the dearest rate so the budget errs safe", () => {
    const known = costOfCall("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 }).costUsd;
    const unknown = costOfCall("claude-something-new", { input_tokens: 1_000_000, output_tokens: 0 }).costUsd;
    assert.ok(unknown > known);
  });

  it("prices each pass on its own model when a fallback served part of it", () => {
    const cost = costOfCall("claude-opus-5-5", {
      input_tokens: 2_000_000,
      output_tokens: 0,
      iterations: [
        { model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 0 },
        { model: "claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 0 },
      ],
    });
    assert.ok(Math.abs(cost.costUsd - (4 + 2)) < 1e-9);
  });
});

describe("dailyBudgetUsd", () => {
  const original = process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD;
  afterEach(() => {
    if (original === undefined) delete process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD;
    else process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = original;
  });

  it("defaults to $5", () => {
    delete process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD;
    assert.equal(dailyBudgetUsd(), DEFAULT_DAILY_BUDGET_USD);
  });

  it("reads the configured cap, and 0 turns paid lookups off", () => {
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "12.5";
    assert.equal(dailyBudgetUsd(), 12.5);
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "0";
    assert.equal(dailyBudgetUsd(), 0);
  });

  it("ignores a nonsense value rather than lifting the cap", () => {
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "lots";
    assert.equal(dailyBudgetUsd(), DEFAULT_DAILY_BUDGET_USD);
    process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD = "-3";
    assert.equal(dailyBudgetUsd(), DEFAULT_DAILY_BUDGET_USD);
  });
});

describe("UTC day boundaries", () => {
  it("resets the budget at UTC midnight", () => {
    const now = new Date("2026-10-17T23:59:00Z");
    assert.equal(startOfUtcDay(now).toISOString(), "2026-10-17T00:00:00.000Z");
    assert.equal(nextUtcMidnight(now).toISOString(), "2026-10-18T00:00:00.000Z");
  });
});

describe("summarizeSpend", () => {
  const now = new Date("2026-10-17T15:00:00Z");
  const at = (iso: string, costUsd: number, estimated = false) => ({ createdAt: new Date(iso), costUsd, estimated });

  it("reports how far a day went over the soft cap instead of hiding it", () => {
    const summary = summarizeSpend(
      [at("2026-10-17T09:00:00Z", 4.6), at("2026-10-17T09:01:00Z", 0.82), at("2026-10-16T10:00:00Z", 1)],
      5,
      3,
      now
    );
    assert.equal(summary.softCap, true);
    assert.equal(summary.days[0].day, "2026-10-17");
    assert.ok(Math.abs(summary.days[0].spentUsd - 5.42) < 1e-9);
    assert.ok(Math.abs(summary.days[0].overBudgetUsd - 0.42) < 1e-9);
    assert.equal(summary.days[0].calls, 2);
    assert.equal(summary.days[1].overBudgetUsd, 0);
    assert.equal(summary.days[2].calls, 0);
  });

  it("separates estimated cost for calls that never reported usage", () => {
    const summary = summarizeSpend([at("2026-10-17T09:00:00Z", 1, true), at("2026-10-17T10:00:00Z", 0.5)], 5, 1, now);
    assert.equal(summary.days[0].estimatedUsd, 1);
    assert.equal(summary.days[0].spentUsd, 1.5);
  });
});
