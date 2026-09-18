import { SignJWT } from "jose";

/**
 * Mints the short-lived Supabase-compatible JWT that lets a staff browser
 * subscribe to its own shop's private Realtime channel.
 *
 * This is *not* a second authentication system. NextAuth remains the only
 * thing that authenticates a staff user; this module only re-states an
 * already-authenticated server-side decision in the form Supabase Realtime
 * can verify. Callers must resolve `shopId` from the session (see
 * `requireStaffShop`) — never from anything the browser sent.
 *
 * The token is signed with the project's JWT secret (HS256), which is what
 * Supabase Realtime validates against when authorizing a private channel.
 */

/** Deliberately short: a leaked token is useless within minutes. */
export const REALTIME_TOKEN_TTL_SECONDS = 300;

let warnedUnconfigured = false;

export type RealtimeToken = {
  token: string;
  /** Epoch milliseconds, so the browser can refresh ahead of expiry. */
  expiresAt: number;
};

function getJwtSecret(): Uint8Array | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[realtime] SUPABASE_JWT_SECRET not set — staff cannot authorize the private " +
          "jobs channel, so boards will only refresh on foreground sync."
      );
    }
    return null;
  }
  return new TextEncoder().encode(secret);
}

/**
 * Returns a signed token carrying the caller's authorized shop, or `null`
 * when Realtime is not configured for this environment.
 */
export async function mintRealtimeToken(params: {
  userId: string;
  shopId: string;
}): Promise<RealtimeToken | null> {
  const secret = getJwtSecret();
  if (!secret) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + REALTIME_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    // `role` and `aud` are what Supabase's RLS `to authenticated` clause keys on.
    role: "authenticated",
    // The claim the realtime.messages policy compares against the channel topic.
    shop_id: params.shopId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(params.userId)
    .setAudience("authenticated")
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(secret);

  return { token, expiresAt: expiresAtSeconds * 1000 };
}
