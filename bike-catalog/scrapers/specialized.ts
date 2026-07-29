import { normalizeLabelToSlot } from "../lib/slots";
import type { UpsertBikeInput, UpsertComponentInput } from "../lib/upsert";
import { upsertCatalogBike, ensureBrand } from "../lib/upsert";
import { catalogPrisma } from "../lib/db";
import fs from "fs";
import path from "path";

const DEFAULT_HEADERS = {
  "User-Agent":
    "BikeOpsCatalogBot/0.1 (+https://bikeops.co; catalog research; respectful crawl)",
  Accept: "text/html,application/xhtml+xml",
};

const SLEEP_MS = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract year from product title or URL when present */
function extractYear(...texts: string[]): number | null {
  for (const text of texts) {
    const m = text.match(/\b(20[1-3]\d)\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Parse simple HTML definition lists / tables into label→value pairs.
 * Specialized and many OEM pages use <tr><th>Label</th><td>Value</td></tr> or dt/dd.
 */
export function parseSpecPairsFromHtml(html: string): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = [];
  const rowRe =
    /<(?:tr|div)[^>]*>[\s\S]*?<(?:th|dt|td|span)[^>]*>([\s\S]*?)<\/(?:th|dt|td|span)>[\s\S]*?<(?:td|dd|span)[^>]*>([\s\S]*?)<\/(?:td|dd|span)>[\s\S]*?<\/(?:tr|div)>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const label = stripTags(match[1]).trim();
    const value = stripTags(match[2]).trim();
    if (label && value && label.length < 80 && value.length < 300) {
      pairs.push({ label, value });
    }
  }

  const dtDdRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((match = dtDdRe.exec(html)) !== null) {
    const label = stripTags(match[1]).trim();
    const value = stripTags(match[2]).trim();
    if (label && value) pairs.push({ label, value });
  }

  return pairs;
}

function stripTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function pairsToComponents(
  pairs: Array<{ label: string; value: string }>
): UpsertComponentInput[] {
  const components: UpsertComponentInput[] = [];
  const seen = new Set<string>();
  for (const { label, value } of pairs) {
    const slot = normalizeLabelToSlot(label);
    if (!slot || seen.has(slot)) continue;
    seen.add(slot);
    components.push({ slot, value, label });
  }
  return components;
}

export type ScrapeProgress = {
  bikesUpserted: number;
  componentsUpserted: number;
  errorCount: number;
  messages: string[];
};

type FixtureBike = {
  model: string;
  family?: string;
  year?: number;
  category?: string;
  sourceUrl?: string;
  components: UpsertComponentInput[];
};

async function ingestFixtures(fixturePath: string, dryRun: boolean, progress: ScrapeProgress) {
  const raw = fs.readFileSync(fixturePath, "utf8");
  const bikes = JSON.parse(raw) as FixtureBike[];
  for (const bike of bikes) {
    const bikeInput: UpsertBikeInput = {
      brandName: "Specialized",
      brandAliases: ["Specialized Bicycle Components", "SBC"],
      scraperKey: "specialized",
      model: bike.model,
      family: bike.family ?? null,
      year: bike.year ?? null,
      category: bike.category ?? null,
      sourceUrl: bike.sourceUrl ?? null,
      confidence: 0.9,
      components: bike.components,
    };
    if (dryRun) {
      progress.messages.push(`Dry run fixture: ${bike.year ?? ""} ${bike.model}`);
      progress.bikesUpserted += 1;
      progress.componentsUpserted += bike.components.length;
      continue;
    }
    const result = await upsertCatalogBike(bikeInput);
    progress.bikesUpserted += 1;
    progress.componentsUpserted += result.componentsUpserted;
    progress.messages.push(`Fixture upserted ${bike.year ?? ""} ${bike.model}`);
  }
}

/**
 * Specialized brand adapter.
 * Accepts product page URLs and/or JSON fixtures. Live Specialized pages are often
 * JS-rendered; fixtures (and seed data) are the reliable path until a headless
 * parser is added.
 */
export async function scrapeSpecialized(options: {
  urls?: string[];
  fixturePath?: string;
  dryRun?: boolean;
}): Promise<ScrapeProgress> {
  const progress: ScrapeProgress = {
    bikesUpserted: 0,
    componentsUpserted: 0,
    errorCount: 0,
    messages: [],
  };

  await ensureBrand({
    name: "Specialized",
    slug: "specialized",
    aliases: ["Specialized Bicycle Components", "SBC"],
    scraperKey: "specialized",
  });

  if (options.fixturePath) {
    await ingestFixtures(options.fixturePath, Boolean(options.dryRun), progress);
  }

  const urls = options.urls ?? [];
  for (const url of urls) {
    try {
      await sleep(SLEEP_MS);
      const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: "follow" });
      if (!res.ok) {
        progress.errorCount += 1;
        progress.messages.push(`HTTP ${res.status} for ${url}`);
        continue;
      }
      const html = await res.text();
      const titleMatch =
        html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? stripTags(titleMatch[1]) : "Unknown Specialized";
      const pairs = parseSpecPairsFromHtml(html);
      const components = pairsToComponents(pairs);

      if (components.length === 0) {
        progress.messages.push(`No spec table rows parsed for ${url} (page may be JS-rendered)`);
        progress.errorCount += 1;
        continue;
      }

      const year = extractYear(title, url);
      const model = title
        .replace(/\b20[1-3]\d\b/g, "")
        .replace(/\|\s*Specialized.*$/i, "")
        .replace(/Specialized/gi, "")
        .trim()
        .replace(/\s+/g, " ");

      const bikeInput: UpsertBikeInput = {
        brandName: "Specialized",
        brandAliases: ["Specialized Bicycle Components", "SBC"],
        scraperKey: "specialized",
        model: model || "Unknown",
        year,
        category: null,
        sourceUrl: url,
        confidence: 0.7,
        components,
      };

      if (options.dryRun) {
        progress.messages.push(
          `Dry run: would upsert ${year ?? ""} ${model} (${components.length} components)`
        );
        progress.bikesUpserted += 1;
        progress.componentsUpserted += components.length;
        continue;
      }

      const result = await upsertCatalogBike(bikeInput);
      progress.bikesUpserted += 1;
      progress.componentsUpserted += result.componentsUpserted;
      progress.messages.push(`Upserted ${result.brand.name} ${year ?? ""} ${model}`);
    } catch (err) {
      progress.errorCount += 1;
      progress.messages.push(err instanceof Error ? err.message : String(err));
    }
  }

  return progress;
}

export async function runSpecializedScrape(options: {
  urls?: string[];
  fixturePath?: string;
  dryRun?: boolean;
}) {
  const brand = await ensureBrand({
    name: "Specialized",
    slug: "specialized",
    aliases: ["Specialized Bicycle Components", "SBC"],
    scraperKey: "specialized",
  });

  const run = await catalogPrisma.scrapeRun.create({
    data: {
      brandId: brand.id,
      scraperKey: "specialized",
      status: "RUNNING",
    },
  });

  try {
    const defaultFixture = path.join(__dirname, "fixtures", "specialized-sample.json");
    const fixturePath =
      options.fixturePath ?? (options.urls?.length ? undefined : defaultFixture);

    const progress = await scrapeSpecialized({
      ...options,
      fixturePath,
    });
    const status =
      progress.errorCount === 0
        ? "SUCCESS"
        : progress.bikesUpserted > 0
          ? "PARTIAL"
          : "FAILED";

    await catalogPrisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status,
        bikesUpserted: progress.bikesUpserted,
        componentsUpserted: progress.componentsUpserted,
        errorCount: progress.errorCount,
        message: progress.messages.slice(0, 20).join("\n"),
        finishedAt: new Date(),
      },
    });

    return { runId: run.id, ...progress, status };
  } catch (err) {
    await catalogPrisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        message: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
