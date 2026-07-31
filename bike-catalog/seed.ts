import { upsertCatalogBike } from "./lib/upsert";
import type { UpsertBikeInput } from "./lib/upsert";
import { catalogPrisma, isCatalogConfigured } from "./lib/db";
import { expandGenerations, SEED_YEAR_MAX, SEED_YEAR_MIN } from "./lib/seed-expand";
import { seedGenerations } from "./seed-generations";

function isRetriableDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "P1017" ||
    code === "P1001" ||
    code === "P1002" ||
    /closed the connection|Can't reach database|timed out/i.test(message)
  );
}

async function upsertWithRetry(bike: UpsertBikeInput, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await upsertCatalogBike(bike);
    } catch (error) {
      lastError = error;
      if (!isRetriableDbError(error) || attempt === attempts) throw error;
      console.warn(
        `DB connection issue on ${bike.brandName} ${bike.year} ${bike.model} (attempt ${attempt}/${attempts}); retrying…`
      );
      try {
        await catalogPrisma.$disconnect();
      } catch {
        // ignore disconnect failures
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      await catalogPrisma.$connect();
    }
  }
  throw lastError;
}

async function main() {
  if (!isCatalogConfigured()) {
    throw new Error("CATALOG_DATABASE_URL or DATABASE_URL must be set to seed the catalog");
  }

  const seedBikes = expandGenerations(seedGenerations);
  console.log(
    `Expanding ${seedGenerations.length} generations → ${seedBikes.length} year rows (${SEED_YEAR_MIN}–${SEED_YEAR_MAX})`
  );

  let bikes = 0;
  let components = 0;
  for (const bike of seedBikes) {
    const result = await upsertWithRetry(bike);
    bikes += 1;
    components += result.componentsUpserted;
    if (bikes % 25 === 0 || bikes === seedBikes.length) {
      console.log(`… ${bikes}/${seedBikes.length} bikes upserted`);
    }
  }

  console.log(`Seed complete: ${bikes} bikes, ${components} components`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await catalogPrisma.$disconnect();
  });
