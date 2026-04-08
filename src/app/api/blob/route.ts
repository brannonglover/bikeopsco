import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";

/**
 * Proxy route to serve blobs from a private Vercel Blob store.
 * Use when BLOB_ACCESS=private - img src should be /api/blob?path=<pathname>
 */
export async function GET(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const path = request.nextUrl.searchParams.get("path");
  const url = request.nextUrl.searchParams.get("url");

  const urlOrPath = path ?? url;
  if (!urlOrPath) {
    return NextResponse.json({ error: "Missing path or url" }, { status: 400 });
  }

  try {
    const result = await get(urlOrPath, { access: "private", useCache: false });

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304 });
    }

    const { stream, blob } = result;
    const contentType = blob.contentType ?? "application/octet-stream";

    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Blob proxy error:", error);
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }
}
