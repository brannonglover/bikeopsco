/**
 * Server-side helpers for fetching live review data from Google Places API,
 * Google Business Profile (all reviews), and Yelp Fusion API.
 */

import {
  getGoogleBusinessProfileConfig,
  isGoogleBusinessProfileEnabledForShop,
} from "@/lib/env";

export interface ReviewEntry {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
  /** ISO timestamp if available (used for sorting "latest") */
  createdAt?: string | null;
  platform: "google" | "yelp";
}

export interface GooglePlaceData {
  rating: number;
  reviewCount: number;
  reviews: ReviewEntry[];
  source: "places" | "business-profile";
}

export interface YelpBusinessData {
  rating: number;
  reviewCount: number;
  reviews: ReviewEntry[];
}

// ─── Google ──────────────────────────────────────────────────────────────────

/**
 * Attempt to extract a Google Place ID from common review URL formats.
 * Works for `search.google.com/local/writereview?placeid=...` and
 * `maps.google.com/maps?...&cid=...` style URLs.
 * Returns null for formats it can't parse (e.g. g.page/r/ short URLs).
 */
export function extractPlaceIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // search.google.com/local/writereview?placeid=ChIJXXX
    const placeid = parsed.searchParams.get("placeid");
    if (placeid) return placeid;
  } catch {
    // ignore malformed URLs
  }
  return null;
}

/**
 * Follow a Google short URL (g.page/r/ or maps.app.goo.gl) server-side and
 * attempt to extract the Place ID from the final destination URL.
 */
export async function resolveGoogleShortUrl(url: string): Promise<string | null> {
  if (!url.includes("g.page") && !url.includes("goo.gl") && !url.includes("maps.app")) {
    return null;
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return extractPlaceIdFromUrl(res.url);
  } catch {
    return null;
  }
}

/**
 * Fetch place details + up to 5 reviews from the Google Places API (New).
 * Results cached by Next.js for 1 hour.
 */
export async function fetchGooglePlaceData(
  placeId: string,
  apiKey: string
): Promise<GooglePlaceData | null> {
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "rating,userRatingCount,reviews",
          "Accept-Language": "en",
        },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) {
      console.error(`Google Places API ${res.status}:`, await res.text());
      return null;
    }
    const data = await res.json();
    const reviews: ReviewEntry[] = (data.reviews ?? []).map(
      (r: {
        rating?: number;
        text?: { text?: string };
        authorAttribution?: { displayName?: string };
        relativePublishTimeDescription?: string;
        publishTime?: string;
      }) => ({
        platform: "google" as const,
        author: r.authorAttribution?.displayName ?? "Anonymous",
        rating: r.rating ?? 5,
        text: r.text?.text ?? "",
        relativeTime: r.relativePublishTimeDescription ?? "",
        createdAt: typeof r.publishTime === "string" ? r.publishTime : null,
      })
    );
    return {
      rating: data.rating ?? 0,
      reviewCount: data.userRatingCount ?? 0,
      reviews,
      source: "places",
    };
  } catch (err) {
    console.error("fetchGooglePlaceData error:", err);
    return null;
  }
}

// ─── Google Business Profile (all reviews) ───────────────────────────────────

const GBP_STAR_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

type GbpTokenCache = { accessToken: string; expiresAt: number };
let gbpTokenCache: GbpTokenCache | null = null;

type GbpReviewCache = { data: GooglePlaceData; expiresAt: number };
let gbpReviewCache: GbpReviewCache | null = null;

function relativeTimeFromIso(iso: string | undefined): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months === 1) return "a month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

async function getGbpAccessToken(config: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string | null> {
  if (gbpTokenCache && gbpTokenCache.expiresAt > Date.now() + 30_000) {
    return gbpTokenCache.accessToken;
  }
  const body = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`GBP token refresh ${res.status}:`, await res.text());
    gbpTokenCache = null;
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  const expiresInMs = Math.max(60, Number(data.expires_in) || 3600) * 1000;
  gbpTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };
  return data.access_token;
}

type GbpReview = {
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
};

type GbpListResponse = {
  reviews?: GbpReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
};

/**
 * Fetch every Google review for the connected Business Profile location.
 * Places API only returns 5 "most relevant" reviews; this uses the owner API.
 */
export async function fetchGoogleBusinessProfileReviews(): Promise<GooglePlaceData | null> {
  const config = getGoogleBusinessProfileConfig();
  if (!config) return null;

  if (gbpReviewCache && gbpReviewCache.expiresAt > Date.now()) {
    return gbpReviewCache.data;
  }

  try {
    const accessToken = await getGbpAccessToken(config);
    if (!accessToken) return null;

    const reviews: ReviewEntry[] = [];
    let pageToken = "";
    let averageRating = 0;
    let totalReviewCount = 0;

    for (let page = 0; page < 20; page++) {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(config.accountId)}/locations/${encodeURIComponent(config.locationId)}/reviews`
      );
      url.searchParams.set("pageSize", "50");
      url.searchParams.set("orderBy", "updateTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) {
        console.error(`GBP reviews.list ${res.status}:`, await res.text());
        return gbpReviewCache?.data ?? null;
      }
      const data = (await res.json()) as GbpListResponse;
      averageRating = data.averageRating ?? averageRating;
      totalReviewCount = data.totalReviewCount ?? totalReviewCount;
      for (const review of data.reviews ?? []) {
        reviews.push({
          platform: "google",
          author: review.reviewer?.displayName ?? "Anonymous",
          rating: GBP_STAR_MAP[review.starRating ?? ""] ?? 5,
          text: review.comment ?? "",
          relativeTime: relativeTimeFromIso(review.updateTime || review.createTime),
          createdAt: review.updateTime || review.createTime || null,
        });
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }

    const result: GooglePlaceData = {
      rating: averageRating || 0,
      reviewCount: totalReviewCount || reviews.length,
      reviews,
      source: "business-profile",
    };
    gbpReviewCache = { data: result, expiresAt: Date.now() + 60 * 60 * 1000 };
    return result;
  } catch (err) {
    console.error("fetchGoogleBusinessProfileReviews error:", err);
    return gbpReviewCache?.data ?? null;
  }
}

export async function fetchGoogleReviewsForShop(options: {
  shopSubdomain: string;
  placeId?: string | null;
  placesApiKey?: string | null;
}): Promise<GooglePlaceData | null> {
  if (isGoogleBusinessProfileEnabledForShop(options.shopSubdomain)) {
    const gbp = await fetchGoogleBusinessProfileReviews();
    if (gbp && gbp.reviews.length > 0) return gbp;
  }
  if (options.placeId && options.placesApiKey) {
    return fetchGooglePlaceData(options.placeId, options.placesApiKey);
  }
  return null;
}

export function reviewTimestamp(review: ReviewEntry): number {
  if (!review.createdAt) return 0;
  const t = Date.parse(review.createdAt);
  return Number.isFinite(t) ? t : 0;
}

/** Sort live reviews newest-first, fill with featured if needed, and keep the latest 5. */
export function selectDisplayReviews(
  live: ReviewEntry[],
  featured: ReviewEntry[] = []
): ReviewEntry[] {
  const latest = live.slice().sort((a, b) => reviewTimestamp(b) - reviewTimestamp(a));
  if (latest.length === 0) return featured.slice(0, 5);
  const seen = new Set(
    latest.map((r) => `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim())
  );
  const filler = featured.filter((r) => {
    const k = `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...latest, ...filler].slice(0, 5);
}

// ─── Yelp ────────────────────────────────────────────────────────────────────

/** Extract the Yelp business alias from a write-review URL. */
export function extractYelpAlias(url: string): string | null {
  const match = url.match(/yelp\.com\/(?:writeareview\/biz|biz)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/**
 * Fetch business details + up to 3 reviews from the Yelp Fusion API.
 * Results cached by Next.js for 1 hour.
 */
export async function fetchYelpBusinessData(
  alias: string,
  apiKey: string
): Promise<YelpBusinessData | null> {
  try {
    const [bizRes, revRes] = await Promise.all([
      fetch(`https://api.yelp.com/v3/businesses/${alias}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 3600 },
      }),
      fetch(`https://api.yelp.com/v3/businesses/${alias}/reviews?limit=20`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 3600 },
      }),
    ]);

    if (!bizRes.ok) {
      console.error(`Yelp business API ${bizRes.status}:`, await bizRes.text());
      return null;
    }

    const biz = await bizRes.json();
    let reviews: ReviewEntry[] = [];

    if (revRes.ok) {
      const revData = await revRes.json();
      reviews = (revData.reviews ?? []).map(
        (r: {
          rating?: number;
          text?: string;
          user?: { name?: string };
          time_created?: string;
        }) => ({
          platform: "yelp" as const,
          author: r.user?.name ?? "Anonymous",
          rating: r.rating ?? 5,
          text: r.text ?? "",
          relativeTime: r.time_created
            ? new Date(r.time_created).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })
            : "",
          createdAt: r.time_created ?? null,
        })
      );
    }

    return {
      rating: biz.rating ?? 0,
      reviewCount: biz.review_count ?? 0,
      reviews,
    };
  } catch (err) {
    console.error("fetchYelpBusinessData error:", err);
    return null;
  }
}
