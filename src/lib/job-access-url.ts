/** Client-safe helpers — pass through signed ?access= from customer links. */

export function readJobAccessParam(params: { get(name: string): string | null }): string | null {
  return params.get("access")?.trim() || null;
}

export function withJobAccessQuery(url: string, access: string | null): string {
  if (!access) return url;
  const q = `access=${encodeURIComponent(access)}`;
  return url.includes("?") ? `${url}&${q}` : `${url}?${q}`;
}

export function jobAccessApiSuffix(access: string | null): string {
  return access ? `?access=${encodeURIComponent(access)}` : "";
}
