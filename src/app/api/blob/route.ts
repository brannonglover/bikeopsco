import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const dynamic = "force-dynamic";

/**
 * Proxy route to serve blobs from a private Vercel Blob store.
 * Use when BLOB_ACCESS=private - img src should be /api/blob?path=<pathname>
 *
 * Serves video as well as images, which is why it speaks range requests: a
 * player asks for a couple of bytes before it will commit to an asset, and
 * answering that probe with a whole-file 200 reads as "not playable" rather
 * than as a slow server. The store itself honours Range, so the work here is
 * passing the header through and relaying the reply faithfully.
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

  const range = request.headers.get("range");

  try {
    const result = await get(urlOrPath, {
      access: "private",
      useCache: false,
      ...(range ? { headers: { range } } : {}),
    });

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304 });
    }

    const { stream, blob, headers } = result;
    const contentRange = headers.get("content-range");
    const contentLength = headers.get("content-length");

    const responseHeaders = new Headers({
      "Content-Type": blob.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      // Advertised even on a full response: a player checks for this before it
      // bothers asking for a range at all.
      "Accept-Ranges": "bytes",
    });
    if (contentLength) responseHeaders.set("Content-Length", contentLength);
    if (blob.etag) responseHeaders.set("ETag", blob.etag);
    if (contentRange) responseHeaders.set("Content-Range", contentRange);

    return new NextResponse(stream, {
      status: contentRange ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Blob proxy error:", error);
    return NextResponse.json({ error: "Failed to load file" }, { status: 500 });
  }
}
