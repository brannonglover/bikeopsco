export const DEFAULT_ROOT_DOMAIN = "bikeops.co";
export const SHARED_APP_SUBDOMAIN = "app";

export const DEFAULT_RESERVED_SUBDOMAINS = [
  "www",
  SHARED_APP_SUBDOMAIN,
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
