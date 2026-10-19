import { PrismaClient } from "@prisma/client";
import { prismaDriverOptions } from "./db-driver";
import { DEFAULT_CONNECTION_LIMIT, normalizeDatabaseUrlForPrisma } from "./db-url";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const databaseUrl = normalizeDatabaseUrlForPrisma(process.env.DATABASE_URL);
  return new PrismaClient({
    // Prisma's engine, or node-postgres when DATABASE_DRIVER=pg (see db-driver.ts).
    ...prismaDriverOptions(databaseUrl, DEFAULT_CONNECTION_LIMIT.app),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
