import { isSharedAppHost, normalizeHostname } from "@/lib/tenant-domain";

export function isPlatformAdminHost(hostHeader: string | null): boolean {
  const host = normalizeHostname(hostHeader);
  if (!host) return false;

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".lvh.me")) return true;

  return isSharedAppHost(hostHeader);
}
