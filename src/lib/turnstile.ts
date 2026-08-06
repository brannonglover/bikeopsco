/**
 * Cloudflare Turnstile server-side verification for public booking.
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; error: string };

type SiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

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
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null
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
    if (data.success === true) {
      return { ok: true };
    }

    return {
      ok: false,
      error: "Verification failed. Please try again.",
    };
  } catch {
    return {
      ok: false,
      error: "Verification failed. Please try again.",
    };
  }
}

/** Client IP from common proxy headers (Vercel / reverse proxies). */
export function getRequestClientIp(request: {
  headers: { get(name: string): string | null };
}): string | null {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for") ||
    null
  );
}
