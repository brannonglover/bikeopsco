/**
 * Centralized env helpers with fallbacks for Vercel quirks.
 * Some vars (RESEND_API_KEY, NEXT_PUBLIC_APP_URL) occasionally don't
 * reach serverless functions; we support alternative names and Vercel's
 * automatic vars as fallbacks.
 */

/** Resend API key - tries RESEND_API_KEY, then BIKEOPS_RESEND_API_KEY */
export function getResendApiKey(): string | null {
  const key =
    process.env.RESEND_API_KEY?.trim() || process.env.BIKEOPS_RESEND_API_KEY?.trim();
  return key || null;
}

/**
 * App base URL for links. Tries:
 * 1. NEXT_PUBLIC_APP_URL
 * 2. https://VERCEL_PROJECT_PRODUCTION_URL (Vercel automatic)
 * 3. https://VERCEL_URL (Vercel automatic)
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit && (explicit.startsWith("http://") || explicit.startsWith("https://"))) {
    return explicit.replace(/\/$/, "");
  }
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "")}`;
  const url = process.env.VERCEL_URL?.trim();
  if (url) return `https://${url.replace(/^https?:\/\//, "")}`;
  return "";
}
