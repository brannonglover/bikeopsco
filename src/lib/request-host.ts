/**
 * The host a request was made to, for shop routing and for links we send.
 *
 * `X-Forwarded-Host` is only believed when it names the same host as `Host`.
 * Whether a proxy in front of us overwrites or passes through a client-sent
 * value then doesn't matter: a forwarded host that disagrees with the one the
 * request was actually routed by yields no host at all (no shop, a failed
 * webhook signature, the configured app URL for links) — never the forged one.
 */
export function resolveRequestHost(host: string | null | undefined, forwarded: string | null | undefined): string | null {
  const actual = host?.trim() || null;
  const claimed = forwarded
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (!claimed || claimed.length === 0) return actual;
  if (!actual) return null;
  return claimed.every((h) => hostname(h) === hostname(actual)) ? actual : null;
}

export function requestHost(headers: { get(name: string): string | null }): string | null {
  return resolveRequestHost(headers.get("host"), headers.get("x-forwarded-host"));
}

function hostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

/**
 * `https://<host>` for links and webhook URLs, or null when the host can't be
 * trusted (see resolveRequestHost). Plain http only for local dev hosts, so a
 * forged `X-Forwarded-Proto` can't produce a downgraded or non-web link.
 */
export function requestOrigin(headers: { get(name: string): string | null }): string | null {
  const host = requestHost(headers);
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|[^.]+\.localhost|.+\.lvh\.me)(:\d+)?$/i.test(host);
  const proto = local && headers.get("x-forwarded-proto") !== "https" ? "http" : "https";
  return `${proto}://${host}`;
}
