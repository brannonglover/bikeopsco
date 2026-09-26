/**
 * Shared between the public booking form and the server that verifies its
 * tokens. It lives apart from `turnstile.ts` so the client bundle does not have
 * to pull in the Siteverify code just to name the action.
 *
 * Cloudflare echoes the action back from Siteverify, so stamping it here and
 * checking it server-side means a token minted by some other widget on the same
 * site key cannot be spent on a booking.
 */
export const TURNSTILE_BOOKING_ACTION = "booking";
