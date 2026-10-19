export const DEFAULT_ROOT_DOMAIN = "bikeops.co";
export const SHARED_APP_SUBDOMAIN = "app";

export const DEFAULT_RESERVED_SUBDOMAINS = [
  "www",
  SHARED_APP_SUBDOMAIN,
  /** Staging host (dev.bikeops.co) — not a tenant shop; falls back to default shop. */
  "dev",
  "admin",
  "api",
  "assets",
  "billing",
  "book",
  "dashboard",
  "demo",
  "help",
  "login",
  "mail",
  "marketing",
  "status",
  "support",
];

export function normalizeHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0]?.toLowerCase().trim() ?? "";
  return host || null;
}

export function normalizeShopSubdomain(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedSubdomain(
  subdomain: string,
  reservedSubdomains: string[] = DEFAULT_RESERVED_SUBDOMAINS,
): boolean {
  const normalized = normalizeShopSubdomain(subdomain);
  return reservedSubdomains.some((reserved) => reserved.toLowerCase().trim() === normalized);
}

export function getRawSubdomainFromHost(
  hostHeader: string | null,
  opts?: {
    rootDomain?: string;
  },
): string | null {
  const host = normalizeHostname(hostHeader);
  if (!host) return null;

  const rootDomain = (opts?.rootDomain ?? DEFAULT_ROOT_DOMAIN).toLowerCase();

  if (host === "localhost") return null;
  if (host.endsWith(".localhost")) return host.replace(/\.localhost$/, "");
  if (host.endsWith(".lvh.me")) return host.replace(/\.lvh\.me$/, "");

  if (host === rootDomain) return null;
  if (host.endsWith(`.${rootDomain}`)) {
    const sub = host.slice(0, -1 * (`.${rootDomain}`.length));
    return sub || null;
  }

  return null;
}

export function isSharedAppHost(
  hostHeader: string | null,
  opts?: {
    rootDomain?: string;
  },
): boolean {
  return getRawSubdomainFromHost(hostHeader, opts) === SHARED_APP_SUBDOMAIN;
}

export function getSubdomainFromHost(
  hostHeader: string | null,
  opts?: {
    rootDomain?: string;
    defaultSubdomain?: string | null;
    reservedSubdomains?: string[];
  },
): string | null {
  const host = normalizeHostname(hostHeader);
  if (!host) return null;

  const rootDomain = (opts?.rootDomain ?? DEFAULT_ROOT_DOMAIN).toLowerCase();

  // Local dev conveniences (use hosts file or a wildcard dev domain like lvh.me).
  if (host === "localhost") return opts?.defaultSubdomain ?? null;
  const rawSubdomain = getRawSubdomainFromHost(host, { rootDomain });
  if (!rawSubdomain) return null;

  // Production: <shop>.<root-domain>
  if (isReservedSubdomain(rawSubdomain, opts?.reservedSubdomains ?? DEFAULT_RESERVED_SUBDOMAINS)) {
    return null;
  }
  return rawSubdomain;
}

/**
 * What a request's host means for tenancy. Shared by middleware (edge, no DB)
 * and server-side shop resolution so both apply the same rule.
 *
 * - tenant: `<shop>.<root>` (or `<shop>.localhost` / `.lvh.me` in dev).
 * - default: hosts explicitly allowed to serve the default shop — plain
 *   `localhost` in dev, plus DEFAULT_SHOP_HOSTS (e.g. a staging host).
 * - shared: the shared app host (`app.<root>`), which serves no shop.
 * - unknown: everything else — the apex, reserved names like `www.`, other
 *   domains, `*.vercel.app` deployment URLs. Fails closed: no shop.
 */
export type HostKind =
  | { kind: "tenant"; subdomain: string }
  | { kind: "default" }
  | { kind: "shared" }
  | { kind: "unknown" };

/** DEFAULT_SHOP_HOSTS: comma-separated hostnames; `*.example.com` matches any subdomain of it. */
export function parseDefaultShopHosts(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return host === pattern;
}

export function classifyHost(
  hostHeader: string | null,
  opts?: {
    rootDomain?: string;
    defaultSubdomain?: string | null;
    defaultShopHosts?: string[];
    reservedSubdomains?: string[];
    /** Dev convenience; off on Vercel production, where no real request says localhost. */
    allowLocalhost?: boolean;
  },
): HostKind {
  const host = normalizeHostname(hostHeader);
  if (!host) return { kind: "unknown" };

  if (host === "localhost") {
    if (!(opts?.allowLocalhost ?? process.env.VERCEL_ENV !== "production")) return { kind: "unknown" };
    return opts?.defaultSubdomain ? { kind: "tenant", subdomain: opts.defaultSubdomain } : { kind: "default" };
  }

  const raw = getRawSubdomainFromHost(host, { rootDomain: opts?.rootDomain });
  if (raw === SHARED_APP_SUBDOMAIN) return { kind: "shared" };
  if (raw && !isReservedSubdomain(raw, opts?.reservedSubdomains ?? DEFAULT_RESERVED_SUBDOMAINS)) {
    return { kind: "tenant", subdomain: raw };
  }

  if ((opts?.defaultShopHosts ?? []).some((pattern) => matchesHostPattern(host, pattern))) {
    return { kind: "default" };
  }
  return { kind: "unknown" };
}
