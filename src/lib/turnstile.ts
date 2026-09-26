/**
 * Cloudflare Turnstile server-side verification for public booking.
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifyResult =
  | { ok: true; hostname: string | null }
  | { ok: false; error: string };

type SiteverifyResponse = {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export { TURNSTILE_BOOKING_ACTION } from "./turnstile-action";

export function getTurnstileSecretKey(): string | null {
  const key = process.env.TURNSTILE_SECRET_KEY?.trim();
  return key || null;
}

export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key || null;
}

/**
 * Verify a Turnstile token with Cloudflare Siteverify.
 * Fail closed: missing secret, missing token, or unsuccessful verify → not ok.
 *
 * Passing `expectedAction` additionally requires the token to have been minted
 * by the widget that declared that action.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null,
  expectedAction?: string
): Promise<TurnstileVerifyResult> {
  const secret = getTurnstileSecretKey();
  if (!secret) {
    return {
      ok: false,
      error: "Booking verification is not configured. Please try again later.",
    };
  }

  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!trimmed) {
    return {
      ok: false,
      error: "Verification failed. Please complete the security check and try again.",
    };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: trimmed,
    });
    const ip = remoteIp?.split(",")[0]?.trim();
    if (ip) body.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      return {
        ok: false,
        error: "Verification failed. Please try again.",
      };
    }

    const data = (await res.json()) as SiteverifyResponse;
    if (data.success !== true) {
      return {
        ok: false,
        error: "Verification failed. Please try again.",
      };
    }

    // Tokens minted before the widget started stamping an action have none, so
    // only a token that claims a *different* action is rejected. Once every
    // client is on the current build this can tighten to requiring a match.
    if (expectedAction && data.action && data.action !== expectedAction) {
      return {
        ok: false,
        error: "Verification failed. Please try again.",
      };
    }

    return { ok: true, hostname: data.hostname ?? null };
  } catch {
    return {
      ok: false,
      error: "Verification failed. Please try again.",
    };
  }
}

/**
 * Client IP, preferring the headers the hosting platform sets itself.
 *
 * Order matters for correctness, not just preference. `cf-connecting-ip` and
 * `x-real-ip` are ordinary request headers: on Vercel, which is what serves
 * this app, nothing strips them, so a caller can send whatever value it likes
 * and have it believed. `x-vercel-forwarded-for` is written by the platform
 * and cannot be forged from outside, so it goes first, with `x-forwarded-for`
 * — which Vercel overwrites — behind it. The client-controlled headers are
 * kept last so self-hosted and Cloudflare-fronted deployments still work.
 *
 * Only the first entry of a forwarded-for chain is the client; the rest are
 * proxies, and an attacker can prepend their own entries to the value they
 * send, which is another reason the platform header is preferred.
 */
export function getRequestClientIp(request: {
  headers: { get(name: string): string | null };
}): string | null {
  const candidates = [
    request.headers.get("x-vercel-forwarded-for"),
    request.headers.get("x-forwarded-for"),
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
  ];

  for (const value of candidates) {
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }

  return null;
}
