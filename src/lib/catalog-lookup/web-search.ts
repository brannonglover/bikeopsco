import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SLOT_META } from "../../../bike-catalog/lib/slots";
import { normalizeModelName } from "../../../bike-catalog/lib/match";
import type { CatalogComponentSlot, ComponentSource } from "../../../bike-catalog/generated/client";
import {
  checkBudgetForNextCall,
  costOfCall,
  recordAbandonedCall,
  recordCallSpend,
} from "./spend";
import {
  classifyLookupError,
  LookupBudgetError,
  LookupDeadlineError,
  LookupResultError,
} from "./errors";

/**
 * The paid part of a lookup: Claude searches the web for every build a bike
 * was sold in that year, citing a page for each part. What comes back is
 * checked here, not trusted — see validateLookupResult.
 */

export const LOOKUP_MODEL = "claude-opus-5-5";
/** pause_turn continuations before giving up on one search. */
const MAX_CONTINUATIONS = 3;
/** Don't start a call with less time than this left; it would only be cut off. */
const MIN_CALL_MS = 20_000;
/** A build with fewer sourced parts than this isn't worth showing as a build sheet. */
const MIN_SOURCED_COMPONENTS = 3;

const SLOT_KEYS = Object.keys(SLOT_META) as [CatalogComponentSlot, ...CatalogComponentSlot[]];

const ComponentSchema = z.object({
  slot: z.enum(SLOT_KEYS),
  value: z.string().describe("Part exactly as the source lists it, e.g. 'SRAM SX Eagle, 12-speed'"),
  standard: z
    .string()
    .nullable()
    .describe("Fitment standard when the source states it, e.g. 'BSA 73mm', 'Boost 148x12'"),
  sourceUrl: z.string().describe("The page that lists this part for this build"),
  sourceIsManufacturer: z.boolean().describe("true only if sourceUrl is on the brand's own website"),
});

const VariantSchema = z.object({
  model: z
    .string()
    .describe("This build's full model name including trim, as the brand writes it, e.g. 'Fuel EX 8 XT'"),
  family: z.string().nullable().describe("Model family without trim, e.g. 'Fuel EX'"),
  category: z.string().nullable().describe("Mountain, Road, Gravel, Hybrid, E-bike, Kids, …"),
  subcategory: z.string().nullable(),
  components: z.array(ComponentSchema),
});

const LookupResultSchema = z.object({
  found: z.boolean().describe("false when no sourced spec for this bike in this model year could be found"),
  brandName: z.string().describe("Brand as the manufacturer writes it, e.g. 'Specialized'"),
  manufacturerDomain: z
    .string()
    .nullable()
    .describe("The brand's own website domain, e.g. 'trekbikes.com'"),
  configurationsComplete: z
    .boolean()
    .describe(
      "true only if a manufacturer page you read lists the model's builds for that model year and `variants` holds all of them"
    ),
  lineupSourceUrl: z
    .string()
    .nullable()
    .describe("The manufacturer page listing every build of this model for that year; null if you didn't find one"),
  variants: z.array(VariantSchema),
});

export type RawLookupResult = z.infer<typeof LookupResultSchema>;

export type LookupVariant = {
  model: string;
  family: string | null;
  category: string | null;
  subcategory: string | null;
  /** The manufacturer page when one was cited, else the first source. */
  sourceUrl: string | null;
  components: Array<{
    slot: CatalogComponentSlot;
    value: string;
    standard: string | null;
    source: Extract<ComponentSource, "MANUFACTURER" | "THIRD_PARTY">;
    sourceUrl: string;
  }>;
};

export type LookupResult = {
  brandName: string;
  /**
   * Every build sold under this name that year is in `variants` — confirmed
   * by a manufacturer lineup page (lineupSourceUrl), not just the model's say-so.
   * False means other builds may exist, even when only one was found.
   */
  configurationsComplete: boolean;
  /** The manufacturer lineup page, when one was cited and checks out. */
  lineupSourceUrl: string | null;
  variants: LookupVariant[];
};

export type BikeSearchInput = { make: string; model: string; year: number };
export type BikeSearchContext = { deadline: number; lookupKey: string };
/** One paid search; injectable so tests can stand in for Claude. */
export type BikeSearcher = (
  input: BikeSearchInput,
  ctx: BikeSearchContext
) => Promise<LookupResult | null>;

const SYSTEM_PROMPT = `You look up the factory build sheet (stock component spec) of a bicycle for a bike repair shop. Mechanics use it to choose replacement parts that fit, so a wrong part is worse than a missing one.

Rules:
- Find every build (trim/configuration) the brand sold under the shop's model name in the requested model year. "Fuel EX 8" may have been sold as "Fuel EX 8 XT" and "Fuel EX 8 GX AXS" — list each as its own variant. Never pick one build for the shop.
- Set configurationsComplete to true only if a page on the brand's own website lists that model's builds for that year, these are all of them, and you give that page as lineupSourceUrl. Finding one build is not evidence there aren't others. If unsure, false.
- Only list parts a page you read states for that exact build and year. Cite that page in sourceUrl for every part. Leave a part out rather than infer it from another year, another trim, or "typical" specs.
- Prefer the manufacturer's own spec page (current or archived), then reputable retailers and reviews. 99 Spokes and BikeBook are off limits — do not use them. Fetch the spec page when search snippets don't list the parts.
- sourceIsManufacturer is true only for pages on the brand's own website.
- Put fitment standards (bottom bracket shell, axle spacing, headtube/headset, brake mount, rotor size, hanger, seatpost diameter, freehub) in "standard" when the source states them.
- Set found to false if you can't find a sourced spec for this model year.`;

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * A page counts as the manufacturer's only when the model says so AND its
 * host is the brand's domain AND that domain carries the brand's name
 * ("trekbikes.com" for Trek). The model's own label is never enough.
 */
function isManufacturerPage(url: string, claimed: boolean, domain: string | null, brand: string): boolean {
  if (!claimed || !domain) return false;
  const host = hostOf(url);
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (!host || !(host === d || host.endsWith(`.${d}`))) return false;
  const brandWord = normalizeModelName(brand).replace(/ /g, "");
  return brandWord.length > 0 && d.replace(/[^a-z0-9]/g, "").includes(brandWord);
}

/**
 * Turn what the model returned into what may enter the catalog. Pure.
 * Drops parts without a readable source page, duplicate slots, and builds left
 * with too few sourced parts; labels each part manufacturer or third-party.
 */
export function validateLookupResult(raw: RawLookupResult): LookupResult | null {
  if (!raw.found) return null;
  const brandName = raw.brandName.trim();
  const variants: LookupVariant[] = [];
  const seenModels = new Set<string>();

  for (const v of raw.variants) {
    const model = v.model.trim();
    const key = normalizeModelName(model);
    if (!key || seenModels.has(key)) continue;

    const bySlot = new Map<string, LookupVariant["components"][number]>();
    for (const c of v.components) {
      const value = c.value.trim();
      if (!value || bySlot.has(c.slot) || !SLOT_META[c.slot] || !hostOf(c.sourceUrl)) continue;
      bySlot.set(c.slot, {
        slot: c.slot,
        value,
        standard: c.standard?.trim() || null,
        source: isManufacturerPage(c.sourceUrl, c.sourceIsManufacturer, raw.manufacturerDomain, brandName)
          ? "MANUFACTURER"
          : "THIRD_PARTY",
        sourceUrl: c.sourceUrl.trim(),
      });
    }
    const components = [...bySlot.values()];
    if (components.length < MIN_SOURCED_COMPONENTS) continue;

    seenModels.add(key);
    variants.push({
      model,
      family: v.family?.trim() || null,
      category: v.category?.trim() || null,
      subcategory: v.subcategory?.trim() || null,
      sourceUrl:
        components.find((c) => c.source === "MANUFACTURER")?.sourceUrl ?? components[0].sourceUrl,
      components,
    });
  }

  if (variants.length === 0) return null;
  const lineupSourceUrl =
    raw.lineupSourceUrl && isManufacturerPage(raw.lineupSourceUrl, true, raw.manufacturerDomain, brandName)
      ? raw.lineupSourceUrl.trim()
      : null;
  // Complete only with a manufacturer lineup page behind it, and only if no
  // build was dropped on the way in.
  const complete =
    raw.configurationsComplete && lineupSourceUrl != null && variants.length === raw.variants.length;
  return { brandName, configurationsComplete: complete, lineupSourceUrl, variants };
}

/** The parse call this needs; satisfied by the SDK client and by test fakes. */
export type LookupClient = {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
};

/**
 * A BikeSearcher backed by Claude with web search. Records the spend of every
 * call, checks the daily budget before each one, and never runs past
 * `ctx.deadline` — the SDK's own retries are off so a slow call can't double.
 */
export function createWebSearcher(client: LookupClient): BikeSearcher {
  return async ({ make, model, year }, { deadline, lookupKey }) => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: `Find the factory build sheet for this bike.\n\nMake: ${make}\nModel: ${model}\nModel year: ${year}`,
      },
    ];

    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) throw new LookupDeadlineError();
      const budget = await checkBudgetForNextCall();
      if (!budget.ok) throw new LookupBudgetError(budget.spentUsd, budget.budgetUsd);

      let response;
      try {
        response = await client.beta.messages.parse(
          {
            model: LOOKUP_MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium", format: betaZodOutputFormat(LookupResultSchema) },
            system: SYSTEM_PROMPT,
            tools: [
              { type: "web_search_20260209", name: "web_search", max_uses: 5 },
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
            ],
            messages,
          },
          { timeout: remaining, maxRetries: 0, signal: AbortSignal.timeout(remaining) }
        );
      } catch (error) {
        if (classifyLookupError(error).mayHaveBilled) {
          await recordAbandonedCall(lookupKey, LOOKUP_MODEL);
        }
        throw error;
      }

      await recordCallSpend(lookupKey, costOfCall(response.model ?? LOOKUP_MODEL, response.usage));

      if (response.stop_reason === "pause_turn") {
        // The server-side search loop hit its iteration limit; resend as-is to resume.
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal") {
        throw new LookupResultError(
          `Lookup refused (${response.stop_details?.category ?? "unknown"})`,
          false
        );
      }
      if (!response.parsed_output) {
        throw new LookupResultError(`Lookup returned no usable result (${response.stop_reason})`, true);
      }
      return validateLookupResult(response.parsed_output);
    }

    throw new LookupResultError("Lookup did not finish within the continuation limit", true);
  };
}
