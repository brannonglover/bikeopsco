const TRANSIENT_PRISMA_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server timed out
  "P1008", // Operations timed out
  "P1017", // Server closed the connection
  "P2024", // Timed out fetching a new connection from the pool
]);

function isTransientPrismaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return TRANSIENT_PRISMA_CODES.has(String(error.code));
}

/** Retry once on transient pool/connectivity errors (common under serverless load). */
export async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  retries = 1
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientPrismaError(error) || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}
