import "server-only";

import { Prisma as CatalogPrisma } from "../../bike-catalog/generated/client";
import type { CatalogBrand, CatalogLookup } from "../../bike-catalog/generated/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { getAnthropicClient } from "@/lib/ai/client";
import { publishJobEvent } from "@/lib/realtime/publish-job-event";
import { catalogPrisma, isCatalogConfigured } from "../../bike-catalog/lib/db";
import { matchCatalogRow, normalizeModelName } from "../../bike-catalog/lib/match";
import { slugify } from "../../bike-catalog/lib/slots";
import { createCatalogBikeWithComponents } from "../../bike-catalog/lib/upsert";
import { backoffMs, classifyLookupError, LookupBudgetError } from "./catalog-lookup/errors";
import { checkBudgetForNewSearch, nextUtcMidnight } from "./catalog-lookup/spend";
import { confirmedBuildForJobBike } from "./customer-bike-build";
import {
  createWebSearcher,
  type BikeSearcher,
  type LookupResult,
} from "./catalog-lookup/web-search";

/**
 * Grows the bike catalog from the bikes customers actually bring in, without
 * ever guessing which build a bike is.
 *
 * When a job bike is saved: if exactly one catalog build sheet is unmistakably
 * this bike (see bike-catalog/lib/match.ts), it's linked. Otherwise, once per
 * make/model/year across every shop, Claude searches the web for every build
 * sold under that name that year, with a cited page for each part. Each build
 * becomes its own catalog row (SOURCED — not yet checked by a person). Only
 * when the search found a single build and believes it found them all is the
 * job bike linked; otherwise the builds wait on the Parts tab for a mechanic
 * to pick one.
 *
 * All of it runs after the job is saved (waitUntil), with the cron sweep
 * finishing anything that was interrupted, failed, deferred, or held back by
 * the daily budget. It never throws to its caller.
 */

/**
 * Time one lookup may take, start to finish. Background work and the sweep
 * both run in functions limited to 300 s; this leaves room for the rest.
 */
export const LOOKUP_TIME_BUDGET_MS = 230_000;
/** A search claimed longer ago than this was interrupted (it can't still be running). */
const SEARCHING_STALE_MS = 10 * 60_000;
/** A bike nobody could find is searched again after this long. */
const NOT_FOUND_RETRY_MS = 60 * 24 * 60 * 60_000;
/** Paid attempts at one make/model/year before giving up on it. */
export const MAX_SEARCH_ATTEMPTS = 3;
/** Errored lookups for one job bike before the sweep leaves it alone. */
export const MAX_JOB_BIKE_ATTEMPTS = 5;
/** How long a bike waits on someone else's search before checking again. */
const DEFERRED_RECHECK_MS = 5 * 60_000;
const WEB_LOOKUP_EXTERNAL_KEY = "web-lookup";

export type LookupOptions = {
  /** Epoch ms after which no new paid call starts. */
  deadline?: number;
  /** Stands in for the Claude web search (tests). */
  searcher?: BikeSearcher;
};

export type LookupOutcome =
  /** Linked to one build sheet. */
  | "linked"
  /** Already linked (by a mechanic, or earlier) — left as it is. */
  | "already_linked"
  /** Several builds fit; a mechanic picks on the Parts tab. */
  | "needs_choice"
  /** No model or year to search with. */
  | "needs_details"
  | "not_found"
  /** Gave up (permanent error, or too many attempts). */
  | "failed"
  /** Owed: another request is searching for the same bike. */
  | "waiting"
  /** Owed: today's budget is spent. */
  | "budget"
  /** Owed: failed for now, retry scheduled. */
  | "retry"
  | "skipped";

export function catalogLookupKey(make: string, model: string, year: number): string {
  return [make, model, String(year)].map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

function defaultSearcher(): BikeSearcher {
  return async (input, ctx) => {
    const client = getAnthropicClient();
    if (!client) throw new Error("ANTHROPIC_API_KEY is not set");
    return createWebSearcher(client)(input, ctx);
  };
}

/**
 * Run the catalog lookup for these job bikes after the response is sent.
 * Call after the job bike rows are committed. Returns at once.
 */
export function scheduleCatalogLookup(jobBikeIds: string[]): void {
  if (jobBikeIds.length === 0 || !isCatalogConfigured()) return;
  const deadline = Date.now() + LOOKUP_TIME_BUDGET_MS;
  waitUntil(
    Promise.allSettled(jobBikeIds.map((id) => lookupCatalogForJobBike(id, { deadline }))).then(
      (results) => {
        for (const r of results) {
          if (r.status === "rejected") {
            console.error("[catalog-lookup] job bike lookup failed:", r.reason);
          }
        }
      }
    )
  );
}

type Resolution = { outcome: LookupOutcome; owedUntil?: Date; linkTo?: string };

/** Match one job bike to the catalog, searching the web when needed. Never throws. */
export async function lookupCatalogForJobBike(
  jobBikeId: string,
  options: LookupOptions = {}
): Promise<LookupOutcome> {
  const deadline = options.deadline ?? Date.now() + LOOKUP_TIME_BUDGET_MS;
  const searcher = options.searcher ?? defaultSearcher();

  const jobBike = await prisma.jobBike
    .findUnique({
      where: { id: jobBikeId },
      select: {
        id: true,
        jobId: true,
        shopId: true,
        make: true,
        model: true,
        year: true,
        bikeId: true,
        catalogBikeId: true,
        catalogLookupAttempts: true,
      },
    })
    .catch(() => null);
  if (!jobBike || !isCatalogConfigured()) return "skipped";

  // Never second-guess an existing link: a mechanic's pick, or an earlier match.
  if (jobBike.catalogBikeId) {
    await markLookupDone(jobBike.id);
    return "already_linked";
  }

  let resolution: Resolution;
  try {
    resolution = await resolveJobBike(jobBike, { deadline, searcher });
  } catch (error) {
    // Couldn't even get as far as an outcome (DB trouble, a bug). Try again
    // later, a limited number of times.
    console.error("[catalog-lookup] lookup errored:", {
      jobBikeId,
      error: error instanceof Error ? error.message : String(error),
    });
    const attempts = jobBike.catalogLookupAttempts + 1;
    if (attempts >= MAX_JOB_BIKE_ATTEMPTS) {
      await markLookupDone(jobBike.id, { attempts });
      return "failed";
    }
    await markLookupOwed(jobBike.id, new Date(Date.now() + backoffMs(attempts)), { attempts });
    return "retry";
  }

  try {
    if (resolution.linkTo) {
      await prisma.jobBike.update({
        where: { id: jobBike.id },
        data: { catalogBikeId: resolution.linkTo, catalogMatchedAt: new Date() },
      });
    }
    if (resolution.owedUntil) await markLookupOwed(jobBike.id, resolution.owedUntil);
    else await markLookupDone(jobBike.id);
    // The board shows the catalog photo and the Parts tab the build sheet.
    if (resolution.linkTo || resolution.outcome === "needs_choice") {
      await publishJobEvent("job:updated", { jobId: jobBike.jobId, shopId: jobBike.shopId });
    }
  } catch (error) {
    console.error("[catalog-lookup] could not record lookup outcome:", {
      jobBikeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return resolution.outcome;
}

async function resolveJobBike(
  jobBike: { bikeId: string | null; make: string; model: string | null; year: number | null },
  options: { deadline: number; searcher: BikeSearcher }
): Promise<Resolution> {
  const make = jobBike.make.trim();
  const model = jobBike.model?.trim() || null;
  const year = jobBike.year;

  // A mechanic already confirmed which build this customer's bike is.
  const confirmed = await confirmedBuildForJobBike(jobBike);
  if (confirmed) return { outcome: "linked", linkTo: confirmed };

  const match = make ? await matchCatalogRow(make, model, year) : null;
  if (match?.ok) return { outcome: "linked", linkTo: match.bike.id };

  // The web needs a model and a year to land on the right build sheet.
  if (!make || !model || year == null) return { outcome: "needs_details" };
  // The catalog already holds several builds of this bike: the mechanic picks.
  if (match?.reason === "ambiguous") return { outcome: "needs_choice" };

  const search = await searchWebOnce({ make, model, year }, options);
  switch (search.status) {
    case "found": {
      const only = await singleUnambiguousBuild(search, model);
      return only ? { outcome: "linked", linkTo: only } : { outcome: "needs_choice" };
    }
    case "not_found":
      return { outcome: "not_found" };
    case "failed":
      return { outcome: "failed" };
    case "deferred":
      return { outcome: "waiting", owedUntil: new Date(Date.now() + DEFERRED_RECHECK_MS) };
    case "budget":
      return { outcome: "budget", owedUntil: nextUtcMidnight() };
    case "retry":
      return { outcome: "retry", owedUntil: search.retryAt };
  }
}

/**
 * The one build sheet a search result may be linked to without asking, or
 * null. Needs: one build found, a manufacturer lineup page confirming that's
 * every build sold under this name, and the build's name containing what the
 * shop typed. One build found on its own proves nothing about the others.
 */
async function singleUnambiguousBuild(
  search: { catalogBikeIds: string[]; configurationsComplete: boolean },
  typedModel: string
): Promise<string | null> {
  if (search.catalogBikeIds.length !== 1 || !search.configurationsComplete) return null;
  const row = await catalogPrisma.catalogBike.findUnique({
    where: { id: search.catalogBikeIds[0] },
    select: { id: true, model: true, specStatus: true },
  });
  if (!row || row.specStatus === "APPROXIMATE") return null;
  const typed = normalizeModelName(typedModel);
  return ` ${normalizeModelName(row.model)} `.includes(` ${typed} `) ? row.id : null;
}

async function markLookupDone(jobBikeId: string, extra: { attempts?: number } = {}) {
  await prisma.jobBike.update({
    where: { id: jobBikeId },
    data: {
      catalogLookupAt: new Date(),
      catalogLookupNextAt: null,
      ...(extra.attempts != null ? { catalogLookupAttempts: extra.attempts } : {}),
    },
  });
}

async function markLookupOwed(jobBikeId: string, until: Date, extra: { attempts?: number } = {}) {
  await prisma.jobBike.update({
    where: { id: jobBikeId },
    data: {
      catalogLookupAt: null,
      catalogLookupNextAt: until,
      ...(extra.attempts != null ? { catalogLookupAttempts: extra.attempts } : {}),
    },
  });
}

type SearchOutcome =
  | { status: "found"; catalogBikeIds: string[]; configurationsComplete: boolean }
  | { status: "not_found" | "failed" | "deferred" | "budget" }
  | { status: "retry"; retryAt: Date };

/**
 * Search the web for this make/model/year at most once at a time across every
 * shop. The CatalogLookup row is the lock, the retry schedule, and the memory
 * of what was found (or not), so nothing already known is paid for twice.
 */
export async function searchWebOnce(
  bike: { make: string; model: string; year: number },
  options: { deadline: number; searcher: BikeSearcher }
): Promise<SearchOutcome> {
  const key = catalogLookupKey(bike.make, bike.model, bike.year);
  const existing = await catalogPrisma.catalogLookup.findUnique({ where: { key } });
  const now = Date.now();

  let nextAttempts = 1;
  if (existing) {
    const age = now - existing.updatedAt.getTime();
    switch (existing.status) {
      case "FOUND": {
        const stillThere = await catalogPrisma.catalogBike.findMany({
          where: { id: { in: existing.catalogBikeIds } },
          select: { id: true },
        });
        if (stillThere.length > 0) {
          const ids = existing.catalogBikeIds.filter((id) => stillThere.some((r) => r.id === id));
          return {
            status: "found",
            catalogBikeIds: ids,
            configurationsComplete:
              existing.configurationsComplete && ids.length === existing.catalogBikeIds.length,
          };
        }
        break; // Every build it found was deleted — search again.
      }
      case "NOT_FOUND":
        if (age < NOT_FOUND_RETRY_MS) return { status: "not_found" };
        break;
      case "FAILED":
        if (existing.attempts >= MAX_SEARCH_ATTEMPTS) return { status: "failed" };
        if (existing.nextAttemptAt && existing.nextAttemptAt.getTime() > now) {
          return { status: "retry", retryAt: existing.nextAttemptAt };
        }
        nextAttempts = existing.attempts + 1;
        break;
      case "SEARCHING":
        if (age < SEARCHING_STALE_MS) return { status: "deferred" };
        // That search was interrupted mid-way. It counts as an attempt.
        if (existing.attempts >= MAX_SEARCH_ATTEMPTS) {
          await catalogPrisma.catalogLookup.updateMany({
            where: { key, updatedAt: existing.updatedAt },
            data: { status: "FAILED", message: "Interrupted too many times", nextAttemptAt: null },
          });
          return { status: "failed" };
        }
        nextAttempts = existing.attempts + 1;
        break;
    }
  }

  // Check the budget before taking the lock, so a held-back search doesn't
  // block anyone.
  const budget = await checkBudgetForNewSearch(SEARCHING_STALE_MS);
  if (!budget.ok) return { status: "budget" };

  const claimed = existing
    ? (
        await catalogPrisma.catalogLookup.updateMany({
          // Compare-and-set on updatedAt so two requests can't both take over.
          where: { key, updatedAt: existing.updatedAt },
          data: { status: "SEARCHING", attempts: nextAttempts, nextAttemptAt: null, message: null },
        })
      ).count === 1
    : await catalogPrisma.catalogLookup
        .create({ data: { key, ...bike, status: "SEARCHING", attempts: 1 } })
        .then(() => true)
        .catch(() => false); // Another request created it first — it owns the search.
  if (!claimed) return { status: "deferred" };

  try {
    const result = await options.searcher(bike, { deadline: options.deadline, lookupKey: key });
    if (!result) {
      await catalogPrisma.catalogLookup.update({
        where: { key },
        data: { status: "NOT_FOUND", catalogBikeIds: [], message: "No sourced build sheet found" },
      });
      return { status: "not_found" };
    }
    const ids = await saveLookupResult(result, bike.make, bike.year);
    await catalogPrisma.catalogLookup.update({
      where: { key },
      data: {
        status: "FOUND",
        catalogBikeIds: ids,
        configurationsComplete: result.configurationsComplete,
        lineupSourceUrl: result.lineupSourceUrl,
        message: null,
      },
    });
    return { status: "found", catalogBikeIds: ids, configurationsComplete: result.configurationsComplete };
  } catch (error) {
    return recordSearchFailure(key, nextAttempts, error);
  }
}

async function recordSearchFailure(key: string, attempts: number, error: unknown): Promise<SearchOutcome> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);

  if (error instanceof LookupBudgetError) {
    // Not the bike's fault: hand the attempt back and wait for tomorrow.
    await catalogPrisma.catalogLookup.update({
      where: { key },
      data: { status: "FAILED", attempts: attempts - 1, nextAttemptAt: nextUtcMidnight(), message },
    });
    return { status: "budget" };
  }

  const kind = classifyLookupError(error);
  console.error("[catalog-lookup] web search failed:", { key, message, retryable: kind.retryable });
  if (!kind.retryable || attempts >= MAX_SEARCH_ATTEMPTS) {
    await catalogPrisma.catalogLookup.update({
      where: { key },
      data: { status: "FAILED", attempts: MAX_SEARCH_ATTEMPTS, nextAttemptAt: null, message },
    });
    return { status: "failed" };
  }
  const retryAt = new Date(Date.now() + Math.max(backoffMs(attempts), kind.retryAfterMs ?? 0));
  await catalogPrisma.catalogLookup.update({
    where: { key },
    data: { status: "FAILED", attempts, nextAttemptAt: retryAt, message },
  });
  return { status: "retry", retryAt };
}

/**
 * Add each build the search found to the catalog and return their ids.
 * A lookup only ever creates rows: a build already in the catalog for that
 * year (by the same name) is reused untouched, so a search can never
 * overwrite a row someone verified or corrected. Years are the one year
 * searched — spans grow only on evidence, never on the model's say-so.
 */
async function saveLookupResult(result: LookupResult, makeAsEntered: string, year: number): Promise<string[]> {
  const brand = await resolveBrand(result.brandName || makeAsEntered, makeAsEntered);
  const ids: string[] = [];

  for (const variant of result.variants) {
    const existing = await catalogPrisma.catalogBike.findMany({
      where: {
        brandId: brand.id,
        specStatus: { not: "APPROXIMATE" },
        yearStart: { lte: year },
        OR: [{ yearEnd: { gte: year } }, { yearEnd: null, yearStart: year }],
      },
      select: { id: true, model: true },
    });
    const same = existing.find((r) => normalizeModelName(r.model) === normalizeModelName(variant.model));
    if (same) {
      ids.push(same.id);
      continue;
    }

    const externalKey = `${WEB_LOOKUP_EXTERNAL_KEY}-${slugify(variant.model, year)}`;
    const manufacturerShare =
      variant.components.filter((c) => c.source === "MANUFACTURER").length / variant.components.length;
    try {
      const created = await createCatalogBikeWithComponents({
        brandId: brand.id,
        model: variant.model,
        family: variant.family,
        yearStart: year,
        yearEnd: year,
        category: variant.category,
        subcategory: variant.subcategory,
        sourceUrl: variant.sourceUrl,
        externalKey,
        confidence: Math.round((0.5 + 0.4 * manufacturerShare) * 100) / 100,
        specStatus: "SOURCED",
        components: variant.components.map((c) => ({
          slot: c.slot,
          value: c.value,
          standard: c.standard,
          source: c.source,
          sourceUrl: c.sourceUrl,
        })),
      });
      ids.push(created.id);
    } catch (error) {
      // Another search saved the same build a moment ago — use theirs.
      if (error instanceof CatalogPrisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const row = await catalogPrisma.catalogBike.findUnique({
          where: { brandId_externalKey: { brandId: brand.id, externalKey } },
          select: { id: true },
        });
        if (row) {
          ids.push(row.id);
          continue;
        }
      }
      throw error;
    }
  }
  return ids;
}

/**
 * The catalog brand for a lookup result: an existing brand when the name, slug
 * or an alias already matches (so "Specialized Bicycle Components" doesn't
 * become a second Specialized), else a new one. The make as the shop typed it
 * is kept as an alias so the next job with that spelling matches.
 */
async function resolveBrand(brandName: string, makeAsEntered: string): Promise<CatalogBrand> {
  const names = [...new Set([brandName.trim(), makeAsEntered.trim()].filter(Boolean))];
  const existing = await catalogPrisma.catalogBrand.findFirst({
    where: {
      OR: names.flatMap((name) => [
        { name: { equals: name, mode: "insensitive" as const } },
        { slug: slugify(name) },
        { aliases: { has: name } },
      ]),
    },
  });
  const brand =
    existing ??
    (await catalogPrisma.catalogBrand
      .create({ data: { name: names[0], slug: slugify(names[0]), aliases: [] } })
      .catch(async () => {
        const raced = await catalogPrisma.catalogBrand.findUnique({ where: { slug: slugify(names[0]) } });
        if (!raced) throw new Error(`Could not create catalog brand ${names[0]}`);
        return raced;
      }));

  const known = [brand.name, ...brand.aliases].map((n) => n.toLowerCase());
  const newAliases = names.filter((n) => !known.includes(n.toLowerCase()));
  if (newAliases.length === 0) return brand;
  return catalogPrisma.catalogBrand.update({
    where: { id: brand.id },
    data: { aliases: { push: newAliases } },
  });
}

/** Bikes older than this are past the point a parts list helps the job. */
const SWEEP_WINDOW_MS = 14 * 24 * 60 * 60_000;
const SWEEP_BATCH = 5;

/**
 * Run owed lookups: bikes whose lookup never ran (customer bookings), was
 * interrupted, failed for now, waited on another search, or was held back by
 * the budget — once their wait is over. Runs a batch side by side under one
 * deadline so the cron function can't be cut off mid-batch.
 */
export async function sweepCatalogLookups(
  options: { jobBikeIds?: string[]; limit?: number } & LookupOptions = {}
): Promise<{ attempted: number; outcomes: Partial<Record<LookupOutcome, number>> }> {
  if (!isCatalogConfigured()) return { attempted: 0, outcomes: {} };
  const now = new Date();
  const owed = await prisma.jobBike.findMany({
    where: {
      ...(options.jobBikeIds ? { id: { in: options.jobBikeIds } } : {}),
      catalogLookupAt: null,
      catalogLookupAttempts: { lt: MAX_JOB_BIKE_ATTEMPTS },
      OR: [{ catalogLookupNextAt: null }, { catalogLookupNextAt: { lte: now } }],
      createdAt: { gte: new Date(now.getTime() - SWEEP_WINDOW_MS) },
      job: { stage: { notIn: ["COMPLETED", "CANCELLED"] } },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? SWEEP_BATCH,
  });

  const deadline = options.deadline ?? Date.now() + LOOKUP_TIME_BUDGET_MS;
  const results = await Promise.all(
    owed.map(({ id }) => lookupCatalogForJobBike(id, { deadline, searcher: options.searcher }))
  );
  const outcomes: Partial<Record<LookupOutcome, number>> = {};
  for (const r of results) outcomes[r] = (outcomes[r] ?? 0) + 1;
  return { attempted: owed.length, outcomes };
}

export type WebLookupState =
  /** A web search for this bike is running, or about to. */
  | "searching"
  /** Several builds were found; the mechanic picks one from the possible matches. */
  | "needs_choice"
  /** We searched and found no sourced build sheet. */
  | "not_found"
  /** Searching kept failing; it won't retry on its own. */
  | "failed"
  /** Failed for now; a retry is scheduled. */
  | "retrying"
  /** Today's lookup budget is spent; it resumes tomorrow. */
  | "budget"
  /** No model or year, so there's nothing specific enough to search for. */
  | "needs_details";

/**
 * Where the web lookup stands for a job bike the catalog can't match on its
 * own, starting one if none is running or scheduled. For the Parts tab.
 * Pass `known.row` when the lookup row was already read (lookupRowForBike).
 */
export async function webLookupStateForJobBike(
  jobBike: {
    id: string;
    make: string;
    model: string | null;
    year: number | null;
  },
  localMatch: { reason: string },
  known?: { row: CatalogLookup | null }
): Promise<WebLookupState> {
  const model = jobBike.model?.trim();
  if (!jobBike.make.trim() || !model || jobBike.year == null) return "needs_details";
  if (localMatch.reason === "ambiguous") return "needs_choice";
  // Only a real "not in the catalog" may start a paid search; a catalog that
  // couldn't be read says nothing about this bike.
  if (localMatch.reason === "catalog_unavailable") {
    throw new Error("The catalog couldn't be read; not starting a web lookup");
  }

  const row = known
    ? known.row
    : await catalogPrisma.catalogLookup.findUnique({
        where: { key: catalogLookupKey(jobBike.make, model, jobBike.year) },
      });
  const now = Date.now();
  if (row?.status === "SEARCHING") return "searching";
  if (row?.status === "NOT_FOUND") return "not_found";
  if (row?.status === "FAILED" && row.attempts >= MAX_SEARCH_ATTEMPTS) return "failed";
  if (row?.status === "FAILED" && row.nextAttemptAt && row.nextAttemptAt.getTime() > now) {
    return row.message?.startsWith("Daily lookup budget") ? "budget" : "retrying";
  }
  if (row?.status === "FOUND" && (row.catalogBikeIds.length !== 1 || !row.configurationsComplete)) {
    return "needs_choice";
  }
  if (!row || row.status !== "FOUND") {
    const budget = await checkBudgetForNewSearch(SEARCHING_STALE_MS);
    if (!budget.ok) return "budget";
  }

  // Nothing running or scheduled for this bike: run it now. (A FOUND single
  // build only needs linking, which costs nothing.)
  await prisma.jobBike.update({
    where: { id: jobBike.id },
    data: { catalogLookupAt: null, catalogLookupNextAt: null },
  });
  scheduleCatalogLookup([jobBike.id]);
  return "searching";
}

/**
 * What the lineup search established for this make/model/year, if one ran:
 * how many builds it found, and whether a manufacturer page confirmed that's
 * all of them. One build found is not the same as one build sold.
 */
export async function lineupForBike(bike: {
  make: string;
  model: string | null;
  year: number | null;
}): Promise<LineupSummary | null> {
  return lineupFromRow(await lookupRowForBike(bike).catch(() => null));
}

export type LineupSummary = { confirmed: boolean; builds: number; sourceUrl: string | null };

/**
 * The lookup row for this make/model/year, or null when there is none or
 * nothing specific enough to look up. Throws when the catalog can't be read.
 */
export async function lookupRowForBike(bike: {
  make: string;
  model: string | null;
  year: number | null;
}): Promise<CatalogLookup | null> {
  const model = bike.model?.trim();
  if (!model || bike.year == null || !isCatalogConfigured()) return null;
  return catalogPrisma.catalogLookup.findUnique({ where: { key: catalogLookupKey(bike.make, model, bike.year) } });
}

/** The lineup note for a lookup row (see lineupForBike). */
export function lineupFromRow(row: CatalogLookup | null): LineupSummary | null {
  if (!row || row.status !== "FOUND") return null;
  return {
    confirmed: row.configurationsComplete,
    builds: row.catalogBikeIds.length,
    sourceUrl: row.lineupSourceUrl,
  };
}
