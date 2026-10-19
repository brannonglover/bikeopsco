import { lookup as dnsLookup, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import { BlockList, isIP, type LookupFunction } from "net";
import zlib from "zlib";

/**
 * Fetch a URL someone else chose (a pasted image link, a shop's website, a
 * link to preview) without letting it reach anything private.
 *
 * - http/https on the default ports only; no credentials in the URL.
 * - Every address the name resolves to must be public. The check runs inside
 *   the socket's own DNS lookup, so the address that's vetted is the address
 *   that's connected to — a name that re-resolves to 127.0.0.1 between a
 *   check and the connect (DNS rebinding) never gets the chance.
 * - Redirects are followed by hand, each hop re-checked from scratch.
 * - Body size and total time are capped.
 */

export class UnsafeUrlError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64: can embed a private IPv4
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23], // Teredo, benchmarking, ORCHID…
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4: can embed a private IPv4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10],
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1): judge the IPv4 inside.
    const mapped = /^(?:0*:)*:?ffff:(.+)$/.exec(lower);
    if (mapped) {
      const tail = mapped[1];
      if (isIP(tail) === 4) return isPublicAddress(tail);
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
      if (hex) {
        const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
        return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
      }
      return false;
    }
    return !blocked.check(lower, "ipv6");
  }
  return false;
}

/** A URL we're willing to request at all, before any DNS. */
export function assertFetchableUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw.toString());
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https URLs");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    throw new UnsafeUrlError("Only the standard web ports are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError("That address is not public");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("That address is not public");
  }
  return url;
}

type Resolve = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

/**
 * DNS lookup for the socket that refuses any non-public answer. It runs on
 * every connect (no pooled sockets), so each connection is vetted on the
 * address it actually uses.
 */
export function publicOnlyLookup(resolve: Resolve = dnsLookup as unknown as Resolve): LookupFunction {
  return (hostname, options, callback) => resolve(hostname, { ...(options as { family?: number }), all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as unknown as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError("That address is not public"), "", 4);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    }
    callback(null, list[0].address, list[0].family);
  });
}

/** Seams for the tests: the single-request step and the resolver. */
export const safeFetchInternals = { requestOnce, resolve: dnsLookup as unknown as Resolve };

export type SafeResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** True when the body hit maxBytes and was cut off (only with truncate). */
  truncated: boolean;
  url: URL;
};

export async function safeFetch(
  raw: string | URL,
  opts: {
    headers?: Record<string, string>;
    maxBytes: number;
    /** Keep the first maxBytes instead of failing (for reading a page's head). */
    truncate?: boolean;
    timeoutMs?: number;
    maxRedirects?: number;
  }
): Promise<SafeResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  let url = assertFetchableUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await safeFetchInternals.requestOnce(url, opts, deadline);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= (opts.maxRedirects ?? 3)) throw new UnsafeUrlError("Too many redirects");
      url = assertFetchableUrl(new URL(location, url));
      continue;
    }
    return res;
  }
}

function requestOnce(
  url: URL,
  opts: { headers?: Record<string, string>; maxBytes: number; truncate?: boolean },
  deadline: number
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new UnsafeUrlError("Timed out"));
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...opts.headers },
        lookup: publicOnlyLookup(safeFetchInternals.resolve),
        // No keep-alive pool: a pooled socket could skip the lookup above.
        agent: false,
        timeout: remaining,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false, url });
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated, url });
          req.destroy();
        };
        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          if (size + chunk.length > opts.maxBytes) {
            if (!opts.truncate) {
              done = true;
              req.destroy();
              return reject(new UnsafeUrlError("Response too large"));
            }
            chunks.push(chunk.subarray(0, opts.maxBytes - size));
            size = opts.maxBytes;
            return finish(true);
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on("end", () => finish(false));
        stream.on("error", (err) => {
          if (!done) {
            done = true;
            reject(err);
          }
        });
      }
    );
    // `timeout` above is per-idle-socket; this caps the whole exchange, so a
    // server dripping a byte at a time can't hold the request open.
    const timer = setTimeout(() => req.destroy(new UnsafeUrlError("Timed out")), remaining);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new UnsafeUrlError("Timed out")));
    req.on("error", reject);
    req.end();
  });
}
