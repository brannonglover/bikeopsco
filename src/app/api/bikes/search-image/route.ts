import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

/** Serper Google Images - make/model-specific from web (2,500 free queries, no credit card at serper.dev) */
async function searchSerper(make: string, model: string) {
  const query = `${make} ${model} bicycle`.trim();

  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "x-api-key": SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 8 }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Serper error:", res.status, text);
    return null;
  }

  const data = (await res.json()) as {
    images?: Array<{
      imageUrl?: string;
      thumbnailUrl?: string;
      link?: string;
      domain?: string;
      position?: number;
    }>;
  };

  const results = (data.images ?? [])
    .filter((r) => r.imageUrl || r.thumbnailUrl)
    .slice(0, 8)
    .map((r, i) => {
      const fullUrl = r.imageUrl || r.thumbnailUrl!;
      const thumbUrl = r.thumbnailUrl || r.imageUrl!;
      let source = r.domain || "Web";
      try {
        if (r.link) source = new URL(r.link).hostname;
      } catch {
        /* ignore */
      }
      return {
        id: `serper-${i}-${r.position ?? i}`,
        thumbUrl,
        fullUrl,
        source,
        provider: "serper" as const,
      };
    });

  return results;
}

/** Unsplash - generic cycling/bike photos (fallback) */
async function searchUnsplash(make: string, model: string) {
  const query = encodeURIComponent(`${make} ${model} bicycle bike`.trim());
  const url = `https://api.unsplash.com/search/photos?query=${query}&per_page=8&orientation=landscape`;

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      urls: { thumb: string; regular: string };
      user: { name: string };
    }>;
  };

  return (data.results ?? []).map((r) => ({
    id: r.id,
    thumbUrl: r.urls.thumb,
    fullUrl: r.urls.regular,
    source: r.user?.name ?? "Unsplash",
    provider: "unsplash" as const,
  }));
}

/** Uses search params — must not be statically analyzed as a static route. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  noStore();
  const hasSerper = SERPER_API_KEY?.trim();
  const hasUnsplash = UNSPLASH_ACCESS_KEY?.trim();

  if (!hasSerper && !hasUnsplash) {
    return NextResponse.json(
      {
        error:
          "Image search is not configured. Add SERPER_API_KEY (2,500 free queries, no credit card at serper.dev) or UNSPLASH_ACCESS_KEY (unsplash.com/developers) to your .env.",
      },
      { status: 503 }
    );
  }

  try {
    const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
    const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";

    if (!make && !model) {
      return NextResponse.json(
        { error: "Enter make and/or model to search" },
        { status: 400 }
      );
    }

    // Prefer Serper for make/model-specific Google Images (manufacturer sites, shops, reviews)
    let results: Array<{
      id: string;
      thumbUrl: string;
      fullUrl: string;
      source?: string;
      provider?: "serper" | "unsplash";
    }>;
    let provider: "serper" | "unsplash" = "unsplash";

    if (hasSerper) {
      results = (await searchSerper(make, model)) ?? [];
      if (results.length > 0) provider = "serper";
      if (results.length === 0 && hasUnsplash) {
        results = (await searchUnsplash(make, model)) ?? [];
      }
    } else {
      results = (await searchUnsplash(make, model)) ?? [];
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: "No images found. Try different make/model or add a photo manually." },
        { status: 404 }
      );
    }

    return NextResponse.json({ results, provider });
  } catch (error) {
    console.error("Bike image search error:", error);
    return NextResponse.json(
      { error: "Image search failed. Try adding a photo manually." },
      { status: 500 }
    );
  }
}
