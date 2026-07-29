import { PrismaClient } from "../generated/client";

const globalForCatalog = globalThis as unknown as { catalogPrisma?: PrismaClient };

function resolveCatalogDatabaseUrl(): string | undefined {
  return (
    process.env.CATALOG_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    undefined
  );
}

export function createCatalogPrismaClient(): PrismaClient {
  const url = resolveCatalogDatabaseUrl();
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const catalogPrisma = globalForCatalog.catalogPrisma ?? createCatalogPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForCatalog.catalogPrisma = catalogPrisma;
}

export function isCatalogConfigured(): boolean {
  return Boolean(resolveCatalogDatabaseUrl());
}
