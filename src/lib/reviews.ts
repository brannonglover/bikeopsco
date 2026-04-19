/**
 * Server-side helpers for fetching live review data from Google Places API
 * and Yelp Fusion API. Results are cached by Next.js fetch for 1 hour.
 */

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
    };
  } catch (err) {
    console.error("fetchGooglePlaceData error:", err);
    return null;
  }
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
