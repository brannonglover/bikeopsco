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

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BikeOpsChatBot/1.0; +https://bikeops.co)",
        Accept: "text/html,application/xhtml+xml",
      },
      // Only read enough HTML to find the OG tags (first 100KB)
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({ imageUrl: null, title: null });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ imageUrl: null, title: null });
    }

    // Read only the first 100KB to keep this fast
    const reader = response.body?.getReader();
    if (!reader) return NextResponse.json({ imageUrl: null, title: null });

    let html = "";
    let bytesRead = 0;
    const MAX_BYTES = 100_000;

    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytesRead += value.byteLength;
      // Stop once we've passed </head> — no need to read the body
      if (html.includes("</head>")) break;
    }
    reader.cancel();

    const imageUrl = extractMetaContent(html, "og:image") ?? null;
    const title =
      extractMetaContent(html, "og:title") ??
      extractTitle(html) ??
      null;

    return NextResponse.json({ imageUrl, title });
  } catch {
    return NextResponse.json({ imageUrl: null, title: null });
  }
}

function extractMetaContent(html: string, property: string): string | undefined {
  // Matches both property= and name= variants
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const altPattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i"
  );
  const match = pattern.exec(html) ?? altPattern.exec(html);
  return match?.[1];
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim();
}
