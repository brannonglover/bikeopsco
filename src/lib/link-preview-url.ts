/** Strip trailing punctuation often attached to URLs in SMS/chat text. */
export function normalizeExtractedUrl(url: string): string {
  return url.replace(/[)\],.;!?]+$/, "");
}

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

export function extractUrls(text: string): string[] {
  return Array.from(
    new Set((text.match(URL_REGEX) ?? []).map(normalizeExtractedUrl))
  );
}

const ATTRIBUTION_HOSTS = new Set([
  "onelink.me",
  "app.link",
  "bit.ly",
  "t.co",
  "goo.gl",
  "ow.ly",
]);

/**
 * Attribution/redirect links (e.g. AppsFlyer onelink.me) embed the real
 * destination in query params. Server-side fetch often lands on a JS interstitial
 * with no Open Graph tags, so resolve to the canonical URL first.
 */
export function resolveAttributionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (!ATTRIBUTION_HOSTS.has(hostname) && !hostname.endsWith(".onelink.me")) {
      return url;
    }

    const candidates = [
      parsed.searchParams.get("af_web_dp"),
      parsed.searchParams.get("af_ios_url"),
      parsed.searchParams.get("af_android_url"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("u"),
    ];

    for (const candidate of candidates) {
      const resolved = decodeAttributionTarget(candidate);
      if (resolved) return resolved;
    }

    const deepLink = parsed.searchParams.get("deep_link_value");
    if (deepLink) {
      const resolved = decodeAttributionTarget(deepLink);
      if (resolved) return resolved;
    }
  } catch {
    // ignore
  }

  return url;
}

function decodeAttributionTarget(value: string | null): string | null {
  if (!value) return null;

  try {
    const decoded = decodeURIComponent(value);

    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }

    // rei://www.rei.com/product?sku=1901380001
    const customScheme = /^[a-z][a-z0-9+.-]*:\/\/(.+)$/i.exec(decoded);
    if (customScheme) {
      const asHttp = `https://${customScheme[1]}`;
      new URL(asHttp);
      return asHttp;
    }
  } catch {
    // ignore
  }

  return null;
}

export function isReiUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "rei.com" || hostname.endsWith(".rei.com");
  } catch {
    return false;
  }
}

/** REI product pages use /product/{id} or ?sku={id}. */
export function extractReiProductId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const pathMatch = /\/product\/(\d+)/i.exec(parsed.pathname);
    if (pathMatch) return pathMatch[1];

    const sku = parsed.searchParams.get("sku");
    if (sku && /^\d+$/.test(sku)) return sku;
  } catch {
    // ignore
  }

  return undefined;
}

export function titleFromReiUrl(url: string): string | null {
  const productId = extractReiProductId(url);
  if (productId) return `REI Product #${productId}`;
  return null;
}
