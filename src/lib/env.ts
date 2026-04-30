/**
 * Centralized env helpers with fallbacks for Vercel quirks.
 * Some vars (RESEND_API_KEY, NEXT_PUBLIC_APP_URL) occasionally don't
 * reach serverless functions; we support alternative names and Vercel's
 * automatic vars as fallbacks.
 */

export function getGooglePlacesApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export function getYelpApiKey(): string | null {
  return process.env.YELP_API_KEY?.trim() || null;
}

/** Resend API key - tries RESEND_API_KEY, then BIKEOPS_RESEND_API_KEY */
export function getResendApiKey(): string | null {
  const key =
    process.env.RESEND_API_KEY?.trim() || process.env.BIKEOPS_RESEND_API_KEY?.trim();
  return key || null;
}

/**
 * App base URL for links. Tries:
 * 1. NEXT_PUBLIC_APP_URL
 * 2. URL (Netlify - main site URL)
 * 3. DEPLOY_PRIME_URL (Netlify - current deploy URL)
 * 4. https://VERCEL_PROJECT_PRODUCTION_URL (Vercel)
 * 5. https://VERCEL_URL (Vercel)
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit && (explicit.startsWith("http://") || explicit.startsWith("https://"))) {
    return explicit.replace(/\/$/, "");
  }
  const netlifyUrl = process.env.URL?.trim();
  if (netlifyUrl && netlifyUrl.startsWith("http")) return netlifyUrl.replace(/\/$/, "");
  const netlifyDeploy = process.env.DEPLOY_PRIME_URL?.trim();
  if (netlifyDeploy && netlifyDeploy.startsWith("http")) return netlifyDeploy.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "")}`;
  const url = process.env.VERCEL_URL?.trim();
  if (url) return `https://${url.replace(/^https?:\/\//, "")}`;
  return "";
}

export function getShopAppUrl(shopSubdomain?: string | null): string {
  const base = getAppUrl();
  if (!base || !shopSubdomain?.trim()) return base;

  try {
    const url = new URL(base);
    const subdomain = shopSubdomain.trim().toLowerCase();
    const rootDomain = process.env.ROOT_DOMAIN ?? "bikeops.co";

    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
      url.hostname = `${subdomain}.localhost`;
    } else if (url.hostname.endsWith(".lvh.me")) {
      url.hostname = `${subdomain}.lvh.me`;
    } else if (url.hostname === rootDomain || url.hostname.endsWith(`.${rootDomain}`)) {
      url.protocol = "https:";
      url.hostname = `${subdomain}.${rootDomain}`;
      url.port = "";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
}

export function getCustomerStatusUrl(jobId: string, shopSubdomain?: string | null): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  return shopUrl ? `${shopUrl}/status/${encodeURIComponent(jobId)}` : "";
}

export function getStaffAppScheme(): string {
  return process.env.STAFF_APP_SCHEME?.trim() || "bikeops";
}

export function getStaffJobDeepLink(jobId: string): string {
  return `${getStaffAppScheme()}:///(staff)/(jobs)/${encodeURIComponent(jobId)}`;
}

export function getStaffJobOpenUrl(jobId: string): string {
  const appUrl = getAppUrl();
  return appUrl ? `${appUrl}/open/staff/jobs/${encodeURIComponent(jobId)}` : "";
}
