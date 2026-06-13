/**
 * Centralized env helpers with fallbacks for Vercel quirks.
 * Some vars (RESEND_API_KEY, NEXT_PUBLIC_APP_URL) occasionally don't
 * reach serverless functions; we support alternative names and Vercel's
 * automatic vars as fallbacks.
 */

import {
  DEFAULT_ROOT_DOMAIN,
  SHARED_APP_SUBDOMAIN,
} from "./tenant-domain";

/** Marketing-only hosts — no /open/staff/chat routes (causes Vercel 404). */
function isMarketingOnlyHost(hostname: string): boolean {
  const root = DEFAULT_ROOT_DOMAIN.toLowerCase();
  const h = hostname.toLowerCase();
  return h === root || h === `www.${root}`;
}

/** App host for email/SMS links; never the bare marketing apex domain. */
export function getCanonicalAppBaseUrl(): string {
  const appUrl = getAppUrl();
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (!isMarketingOnlyHost(url.hostname)) {
        return appUrl.replace(/\/$/, "");
      }
    } catch {
      // fall through
    }
  }
  return `https://${SHARED_APP_SUBDOMAIN}.${DEFAULT_ROOT_DOMAIN}`;
}

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
 * When set, overrides the default staging guard for customer-facing email/SMS.
 * - "true" — allow sends (use only on an isolated staging DB with test recipients)
 * - "false" — always block
 */
export function getCustomerNotificationBlockReason(): string | null {
  const explicit = process.env.ALLOW_CUSTOMER_NOTIFICATIONS?.trim().toLowerCase();
  if (explicit === "true") return null;
  if (explicit === "false") {
    return "Customer notifications disabled (ALLOW_CUSTOMER_NOTIFICATIONS=false)";
  }

  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "preview") {
    return "Customer notifications disabled on Vercel Preview (staging)";
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().toLowerCase() ?? "";
  if (appUrl.includes("dev.bikeops.co")) {
    return "Customer notifications disabled on dev.bikeops.co";
  }

  return null;
}

export function areCustomerNotificationsEnabled(): boolean {
  return getCustomerNotificationBlockReason() === null;
}

export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
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
  const subdomain = shopSubdomain?.trim().toLowerCase();
  if (!subdomain) return getAppUrl();

  const rootDomain = (process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN).toLowerCase();
  const base = getAppUrl();

  if (base) {
    try {
      const url = new URL(base);

      if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
        url.hostname = `${subdomain}.localhost`;
        return url.toString().replace(/\/$/, "");
      }
      if (url.hostname.endsWith(".lvh.me")) {
        url.hostname = `${subdomain}.lvh.me`;
        return url.toString().replace(/\/$/, "");
      }
      if (url.hostname === rootDomain || url.hostname.endsWith(`.${rootDomain}`)) {
        url.protocol = "https:";
        url.hostname = `${subdomain}.${rootDomain}`;
        url.port = "";
        return url.toString().replace(/\/$/, "");
      }
    } catch {
      // Fall through to tenant URL below.
    }
  }

  // Cron/email links must not depend on a stale NEXT_PUBLIC_APP_URL or Vercel host.
  return `https://${subdomain}.${rootDomain}`;
}

export function getStaffAppScheme(): string {
  return process.env.STAFF_APP_SCHEME?.trim() || "bikeops";
}

export function getStaffJobDeepLink(jobId: string): string {
  // Route groups are omitted from custom-scheme paths (see Expo Router docs).
  return `${getStaffAppScheme()}://jobs/${encodeURIComponent(jobId)}`;
}

export function getStaffChatDeepLink(
  conversationId: string,
  messageId?: string
): string {
  const base = `${getStaffAppScheme()}://chat/${encodeURIComponent(conversationId)}`;
  return messageId
    ? `${base}?messageId=${encodeURIComponent(messageId)}`
    : base;
}

export function getStaffChatUrl(
  baseUrl: string,
  conversationId?: string,
  messageId?: string
): string {
  if (!baseUrl) return "";
  const path = conversationId
    ? `/open/staff/chat/${encodeURIComponent(conversationId)}`
    : "/open/staff/chat";
  const qs = messageId ? `?messageId=${encodeURIComponent(messageId)}` : "";
  return `${baseUrl.replace(/\/$/, "")}${path}${qs}`;
}

/** HTTPS trampoline for staff chat (email / SMS). Prefer shop tenant host. */
export function getStaffChatOpenUrl(
  conversationId: string,
  shopSubdomain?: string | null,
  messageId?: string
): string {
  const base = getShopAppUrl(shopSubdomain) || getCanonicalAppBaseUrl();
  return getStaffChatUrl(base, conversationId, messageId);
}

export function getStaffJobOpenUrl(jobId: string): string {
  const appUrl = getAppUrl();
  return appUrl ? `${appUrl}/open/staff/jobs/${encodeURIComponent(jobId)}` : "";
}
