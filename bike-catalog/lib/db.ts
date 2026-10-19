import { PrismaClient } from "../generated/client";
import { DEFAULT_CONNECTION_LIMIT, normalizeDatabaseUrlForPrisma } from "../../src/lib/db-url";

const globalForCatalog = globalThis as unknown as { catalogPrisma?: PrismaClient };

function resolveCatalogDatabaseUrl(): string | undefined {
  return (
    process.env.CATALOG_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    undefined
  );
}

export function createCatalogPrismaClient(): PrismaClient {
  // Same pooler handling as the app client (shared helper), but its own client
  // with a smaller connection cap, so catalog work can't take the app's
  // connections.
  const url = normalizeDatabaseUrlForPrisma(resolveCatalogDatabaseUrl(), {
    connectionLimit: DEFAULT_CONNECTION_LIMIT.catalog,
  });
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
