/** Server stores typing heartbeats; staff treats as “typing” if within this window. */
export const CUSTOMER_TYPING_MAX_AGE_MS = 5000;

export function isCustomerTypingRecently(
  customerTypingAt: string | null | undefined,
  maxAgeMs: number = CUSTOMER_TYPING_MAX_AGE_MS
): boolean {
  if (!customerTypingAt) return false;
  const t = new Date(customerTypingAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxAgeMs;
}
