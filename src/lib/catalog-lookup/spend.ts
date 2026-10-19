import { catalogPrisma } from "../../../bike-catalog/lib/db";

/**
 * What the web lookup spends, and the daily cap that stops it starting more.
 *
 * The cap is a SOFT ceiling: it stops new paid calls, but a call already in
 * flight can't be stopped, and its cost is only known when it returns — so a
 * day can end over the cap. When that happens it's logged and shown (as
 * overspend) on the admin catalog page; nothing claims the cap held.
 *
 * Every paid Claude call writes one CatalogLookupSpend row. The cap is checked
 * before a search is claimed (reserving an amount for each search already
 * running) and again before each follow-up call within a search. A day is a
 * UTC day.
 */

export const DEFAULT_DAILY_BUDGET_USD = 5;

/**
 * Held against the budget for each search still running, so several starting
 * at once can't all slip under the cap. A real search measured $0.82 (Oct
 * 2026: ~166k input tokens of fetched pages, 4 searches).
 */
export const RESERVE_PER_RUNNING_SEARCH_USD = 1;

/**
 * Recorded for a call that failed after it may have reached the server (a
 * timeout or dropped connection), where we never saw its real usage. Errs high
 * so the budget stays safe.
 */
export const ABANDONED_CALL_ESTIMATE_USD = 1;

/** Server-side web searches are billed per search ($10 per 1,000). */
export const WEB_SEARCH_COST_USD = 0.01;

type ModelPrice = { input: number; output: number; cacheWrite: number; cacheRead: number };

/** US$ per million tokens, from Anthropic's published list prices (Oct 2026). */
const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};
/** A model we have no price for (a fallback we didn't expect) is costed at the dearest. */
const UNKNOWN_MODEL_PRICE = PRICES["claude-fable-5-1"];

function priceFor(model: string | null | undefined): ModelPrice {
  return (model && PRICES[model]) || UNKNOWN_MODEL_PRICE;
}

/** The parts of a response's `usage` this needs; matches the SDK's shape. */
export type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
  /** Present when the server ran several sampling passes, possibly on several models. */
  iterations?: Array<{
    model?: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }> | null;
};

export type CallCost = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
  costUsd: number;
};

function tokenCost(
  price: ModelPrice,
  t: { input: number; output: number; cacheWrite: number; cacheRead: number }
): number {
  return (
    (t.input * price.input +
      t.output * price.output +
      t.cacheWrite * price.cacheWrite +
      t.cacheRead * price.cacheRead) /
    1_000_000
  );
}

/** Estimated cost of one API response. Pure. */
export function costOfCall(model: string, usage: UsageLike): CallCost {
  const totals = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };

  // With a fallback, passes can run on different models; price each on its own.
  const iterations = usage.iterations?.filter((it) => it && typeof it.input_tokens === "number");
  const tokensUsd = iterations?.length
    ? iterations.reduce(
        (sum, it) =>
          sum +
          tokenCost(priceFor(it.model ?? model), {
            input: it.input_tokens,
            output: it.output_tokens,
            cacheWrite: it.cache_creation_input_tokens ?? 0,
            cacheRead: it.cache_read_input_tokens ?? 0,
          }),
        0
      )
    : tokenCost(priceFor(model), totals);

  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
  const webFetches = usage.server_tool_use?.web_fetch_requests ?? 0;
  return {
    model,
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cacheWriteTokens: totals.cacheWrite,
    webSearches,
    webFetches,
    costUsd: tokensUsd + webSearches * WEB_SEARCH_COST_USD,
  };
}

/** CATALOG_LOOKUP_DAILY_BUDGET_USD, default $5. 0 turns paid lookups off. */
export function dailyBudgetUsd(): number {
  const raw = process.env.CATALOG_LOOKUP_DAILY_BUDGET_USD?.trim();
  if (!raw) return DEFAULT_DAILY_BUDGET_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_BUDGET_USD;
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60_000);
}

export async function spentTodayUsd(now: Date = new Date()): Promise<number> {
  const agg = await catalogPrisma.catalogLookupSpend.aggregate({
    where: { createdAt: { gte: startOfUtcDay(now) } },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ?? 0;
}

export type BudgetCheck = { ok: boolean; spentUsd: number; reservedUsd: number; budgetUsd: number };

/**
 * May a new search start? Counts today's spend plus a reserve for every
 * search running right now (searches started within `runningWindowMs`).
 */
export async function checkBudgetForNewSearch(runningWindowMs: number): Promise<BudgetCheck> {
  const budgetUsd = dailyBudgetUsd();
  const [spentUsd, running] = await Promise.all([
    spentTodayUsd(),
    catalogPrisma.catalogLookup.count({
      where: { status: "SEARCHING", updatedAt: { gte: new Date(Date.now() - runningWindowMs) } },
    }),
  ]);
  const reservedUsd = running * RESERVE_PER_RUNNING_SEARCH_USD;
  return { ok: spentUsd + reservedUsd < budgetUsd, spentUsd, reservedUsd, budgetUsd };
}

/** May a search already under way make another call? (Its own reserve isn't counted.) */
export async function checkBudgetForNextCall(): Promise<BudgetCheck> {
  const budgetUsd = dailyBudgetUsd();
  const spentUsd = await spentTodayUsd();
  return { ok: spentUsd < budgetUsd, spentUsd, reservedUsd: 0, budgetUsd };
}

export async function recordCallSpend(lookupKey: string, cost: CallCost): Promise<void> {
  await catalogPrisma.catalogLookupSpend.create({ data: { lookupKey, ...cost } });
  await warnIfOverBudget(lookupKey);
}

export async function recordAbandonedCall(lookupKey: string, model: string): Promise<void> {
  await catalogPrisma.catalogLookupSpend.create({
    data: { lookupKey, model, costUsd: ABANDONED_CALL_ESTIMATE_USD, estimated: true },
  });
  await warnIfOverBudget(lookupKey);
}

async function warnIfOverBudget(lookupKey: string) {
  const budgetUsd = dailyBudgetUsd();
  const spentUsd = await spentTodayUsd();
  if (spentUsd > budgetUsd) {
    console.warn("[catalog-lookup] daily lookup spend is over the soft cap:", {
      lookupKey,
      spentUsd: Number(spentUsd.toFixed(4)),
      budgetUsd,
      overUsd: Number((spentUsd - budgetUsd).toFixed(4)),
    });
  }
}

export type DailySpend = {
  /** UTC date, YYYY-MM-DD */
  day: string;
  spentUsd: number;
  /** Part of spentUsd that's a conservative guess for calls that never reported usage. */
  estimatedUsd: number;
  calls: number;
  /** spentUsd above the cap — the soft ceiling was exceeded by in-flight calls. */
  overBudgetUsd: number;
};

export type SpendSummary = {
  budgetUsd: number;
  /** Always true: the cap stops new calls but can't stop ones in flight. */
  softCap: true;
  days: DailySpend[];
};

/** Per-UTC-day spend for the last `days` days (today first), against today's cap. Pure over rows. */
export function summarizeSpend(
  rows: Array<{ createdAt: Date; costUsd: number; estimated: boolean }>,
  budgetUsd: number,
  days: number,
  now: Date = new Date()
): SpendSummary {
  const start = startOfUtcDay(now).getTime();
  const out: DailySpend[] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = start - i * 24 * 60 * 60_000;
    const inDay = rows.filter((r) => {
      const t = r.createdAt.getTime();
      return t >= dayStart && t < dayStart + 24 * 60 * 60_000;
    });
    const spentUsd = inDay.reduce((sum, r) => sum + r.costUsd, 0);
    out.push({
      day: new Date(dayStart).toISOString().slice(0, 10),
      spentUsd,
      estimatedUsd: inDay.filter((r) => r.estimated).reduce((sum, r) => sum + r.costUsd, 0),
      calls: inDay.length,
      overBudgetUsd: Math.max(0, spentUsd - budgetUsd),
    });
  }
  return { budgetUsd, softCap: true, days: out };
}

export async function spendSummary(days = 7): Promise<SpendSummary> {
  const now = new Date();
  const since = new Date(startOfUtcDay(now).getTime() - (days - 1) * 24 * 60 * 60_000);
  const rows = await catalogPrisma.catalogLookupSpend.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, costUsd: true, estimated: true },
  });
  return summarizeSpend(rows, dailyBudgetUsd(), days, now);
}
