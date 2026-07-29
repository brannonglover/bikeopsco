import fs from "fs";
import path from "path";
import { catalogPrisma } from "../lib/db";
import { ensureBrand, upsertCatalogBike, type UpsertBikeInput, type UpsertComponentInput } from "../lib/upsert";

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
  subcategory?: string;
  sourceUrl?: string;
  components: UpsertComponentInput[];
};

export async function ingestBrandFixtures(options: {
  brandName: string;
  brandSlug: string;
  brandAliases?: string[];
  scraperKey: string;
  fixturePath: string;
  dryRun?: boolean;
}): Promise<ScrapeProgress> {
  const progress: ScrapeProgress = {
    bikesUpserted: 0,
    componentsUpserted: 0,
    errorCount: 0,
    messages: [],
  };

  await ensureBrand({
    name: options.brandName,
    slug: options.brandSlug,
    aliases: options.brandAliases ?? [],
    scraperKey: options.scraperKey,
  });

  if (!fs.existsSync(options.fixturePath)) {
    progress.errorCount += 1;
    progress.messages.push(`Fixture not found: ${options.fixturePath}`);
    return progress;
  }

  const bikes = JSON.parse(fs.readFileSync(options.fixturePath, "utf8")) as FixtureBike[];
  for (const bike of bikes) {
    try {
      const input: UpsertBikeInput = {
        brandName: options.brandName,
        brandAliases: options.brandAliases,
        scraperKey: options.scraperKey,
        model: bike.model,
        family: bike.family ?? null,
        year: bike.year ?? null,
        category: bike.category ?? null,
        subcategory: bike.subcategory ?? null,
        sourceUrl: bike.sourceUrl ?? null,
        confidence: 0.85,
        components: bike.components,
      };
      if (options.dryRun) {
        progress.messages.push(`Dry run fixture: ${bike.year ?? ""} ${bike.model}`);
        progress.bikesUpserted += 1;
        progress.componentsUpserted += bike.components.length;
        continue;
      }
      const result = await upsertCatalogBike(input);
      progress.bikesUpserted += 1;
      progress.componentsUpserted += result.componentsUpserted;
      progress.messages.push(`Fixture upserted ${bike.year ?? ""} ${bike.model}`);
    } catch (err) {
      progress.errorCount += 1;
      progress.messages.push(err instanceof Error ? err.message : String(err));
    }
  }

  return progress;
}

export async function runBrandFixtureScrape(options: {
  brandName: string;
  brandSlug: string;
  brandAliases?: string[];
  scraperKey: string;
  fixturePath?: string;
  defaultFixtureFile: string;
  dryRun?: boolean;
}) {
  const brand = await ensureBrand({
    name: options.brandName,
    slug: options.brandSlug,
    aliases: options.brandAliases ?? [],
    scraperKey: options.scraperKey,
  });

  const run = await catalogPrisma.scrapeRun.create({
    data: {
      brandId: brand.id,
      scraperKey: options.scraperKey,
      status: "RUNNING",
    },
  });

  try {
    const fixturePath =
      options.fixturePath ?? path.join(__dirname, "fixtures", options.defaultFixtureFile);
    const progress = await ingestBrandFixtures({
      brandName: options.brandName,
      brandSlug: options.brandSlug,
      brandAliases: options.brandAliases,
      scraperKey: options.scraperKey,
      fixturePath,
      dryRun: options.dryRun,
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
