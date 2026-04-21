import type { NextResponse } from "next/server";

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function safeParseOriginHostname(origin: string): string | null {
  if (!origin) return null;
  if (origin === "null") return "null";
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    // Some callers may pass a hostname without a scheme.
    // Strip any port if present (e.g. "localhost:3000").
    const withoutPort = origin.replace(/:\d+$/, "");
    return normalizeHostname(withoutPort);
  }
}

function getAllowedWidgetHostSuffixes(): string[] {
  const suffixes: string[] = ["basementbikemechanic.com"];
  const raw = process.env.WIDGET_ALLOWED_HOST_SUFFIXES?.trim() ?? "";
  if (!raw) return suffixes;
  for (const part of raw.split(",")) {
    const s = normalizeHostname(part);
    if (s) suffixes.push(s);
  }
  return Array.from(new Set(suffixes));
}

export function isAllowedWidgetOrigin(origin: string | null): boolean {
  if (!origin) return false;
  // Opaque origins can show up in sandboxed iframes, file://, etc.
  // Allowing "null" improves compatibility for embeds; it's not a security
  // boundary for these public endpoints anyway.
  if (origin === "null") return true;

  const host = safeParseOriginHostname(origin);
  if (!host) return false;

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;

  const allowedSuffixes = getAllowedWidgetHostSuffixes();
  return allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function appendVary(response: NextResponse, value: string) {
  const existing = response.headers.get("Vary");
  if (!existing) {
    response.headers.set("Vary", value);
    return;
  }
  const parts = existing
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) return;
  response.headers.set("Vary", `${existing}, ${value}`);
}

type WidgetCorsOptions = {
  methods: string;
  allowHeaders?: string;
  maxAgeSeconds?: number;
};

export function addWidgetCorsHeaders(
  response: NextResponse,
  origin: string | null,
  options: WidgetCorsOptions
): NextResponse {
  appendVary(response, "Origin");

  if (origin && isAllowedWidgetOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  response.headers.set("Access-Control-Allow-Methods", options.methods);
  if (options.allowHeaders) {
    response.headers.set("Access-Control-Allow-Headers", options.allowHeaders);
  }
  response.headers.set("Access-Control-Max-Age", String(options.maxAgeSeconds ?? 86400));
  return response;
}

