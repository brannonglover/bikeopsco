import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { authorizeBlobRequest, normalizeBlobPathname } from "@/lib/blob-access";

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
 *
 * Every read is authorized here, not in middleware: by the file's owning shop
 * (see blob-access.ts), never by its pathname. Refusals are 404s so a
 * stranger can't tell a private file from a missing one.
 */
export async function GET(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const raw = request.nextUrl.searchParams.get("path") ?? request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing path or url" }, { status: 400 });
  }
  const pathname = normalizeBlobPathname(raw);
  if (!pathname) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let access: Awaited<ReturnType<typeof authorizeBlobRequest>>;
  try {
    access = await authorizeBlobRequest(request, pathname);
  } catch (error) {
    console.error("Blob authorization error:", error);
    return NextResponse.json({ error: "Failed to load file" }, { status: 503 });
  }
  if (!access.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const range = request.headers.get("range");

  try {
    const result = await get(pathname, {
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
      "Cache-Control": cacheControl(access),
      // Advertised even on a full response: a player checks for this before it
      // bothers asking for a range at all.
      "Accept-Ranges": "bytes",
      // Uploads are served from the shop's own origin; never let one run as a page.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
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

/**
 * Only an explicitly public file may sit in a shared cache. Anything else is
 * private to the browser that was authorized for it, and a signed URL isn't
 * cached past its expiry.
 */
function cacheControl(access: { via: string; expiresAt?: number }): string {
  if (access.via === "public") return "public, max-age=31536000, immutable";
  if (access.via === "signature" && access.expiresAt) {
    const remaining = Math.max(0, Math.min(3600, access.expiresAt - Math.floor(Date.now() / 1000)));
    return `private, max-age=${remaining}`;
  }
  return "private, max-age=3600";
}
