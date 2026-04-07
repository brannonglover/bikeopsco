import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url || !/^https?:\/\/.+/.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Block private/internal addresses
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.endsWith(".local")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Amazon blocks server-side scraping from cloud IPs with bot-detection. Instead,
  // extract the ASIN and construct the image URL directly from Amazon's image CDN.
  if (isAmazonUrl(url)) {
    const asin = extractAsin(url);
    if (asin) {
      return NextResponse.json({
        imageUrl: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL500_.jpg`,
        title: titleFromAmazonUrl(url),
      });
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        // Use a realistic browser UA — bot-detection UAs get served a captcha/logo page
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return NextResponse.json({ imageUrl: null, title: null });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ imageUrl: null, title: null });
    }

    // Read up to 200KB — Amazon puts JSON-LD deeper in the page than just the <head>
    const reader = response.body?.getReader();
    if (!reader) return NextResponse.json({ imageUrl: null, title: null });

    let html = "";
    let bytesRead = 0;
    const MAX_BYTES = 200_000;

    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytesRead += value.byteLength;
    }
    reader.cancel();

    // Priority order: og:image → twitter:image → JSON-LD product image → first large img
    const imageUrl =
      extractMetaContent(html, "og:image") ??
      extractMetaContent(html, "twitter:image") ??
      extractJsonLdImage(html) ??
      null;

    const title =
      extractMetaContent(html, "og:title") ??
      extractMetaContent(html, "twitter:title") ??
      extractTitle(html) ??
      null;

    return NextResponse.json({ imageUrl, title });
  } catch {
    return NextResponse.json({ imageUrl: null, title: null });
  }
}

function extractMetaContent(
  html: string,
  property: string
): string | undefined {
  const escaped = property.replace(":", "\\:");
  // property/name before content
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  // content before property/name
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i"
  );
  return (a.exec(html) ?? b.exec(html))?.[1];
}

/**
 * Extracts an image URL from JSON-LD structured data (schema.org Product/ItemPage).
 * Amazon and many other retailers embed this even when og:image is blocked.
 */
function extractJsonLdImage(html: string): string | undefined {
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const image = findImageInJsonLd(data);
      if (image) return image;
    } catch {
      // Malformed JSON — skip
    }
  }
  return undefined;
}

function findImageInJsonLd(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findImageInJsonLd(item);
      if (found) return found;
    }
    return undefined;
  }

  const obj = data as Record<string, unknown>;

  // Prefer "image" field at the top level of a Product/ItemPage
  const type = obj["@type"];
  const isProductLike =
    type === "Product" ||
    type === "ItemPage" ||
    type === "WebPage" ||
    type === "Article" ||
    (typeof type === "string" && type.toLowerCase().includes("product"));

  if (isProductLike && obj.image) {
    const img = obj.image;
    if (typeof img === "string" && img.startsWith("http")) return img;
    if (Array.isArray(img) && typeof img[0] === "string") return img[0] as string;
    if (typeof img === "object" && img !== null) {
      const url = (img as Record<string, unknown>).url;
      if (typeof url === "string") return url;
    }
  }

  // Recurse into nested objects
  for (const val of Object.values(obj)) {
    const found = findImageInJsonLd(val);
    if (found) return found;
  }

  return undefined;
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim();
}

function isAmazonUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes("amazon.") || hostname.includes("amzn.");
  } catch {
    return false;
  }
}

function extractAsin(url: string): string | undefined {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match) return match[1].toUpperCase();
  }
  return undefined;
}

/**
 * Derives a human-readable title from the URL slug.
 * Amazon URLs often look like /Product-Name-Here/dp/ASIN — extract that slug.
 */
function titleFromAmazonUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = /^\/([^/]+)\/dp\//i.exec(pathname);
    if (match && match[1].length > 2) {
      return decodeURIComponent(match[1].replace(/-/g, " "));
    }
  } catch {
    // ignore
  }
  return null;
}
