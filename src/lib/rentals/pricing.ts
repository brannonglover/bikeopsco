import type { RentalCategory } from "@/lib/rentals/types";

export type RateLike = {
  days: number;
  price: number;
  category: RentalCategory | null;
  isActive?: boolean;
};

/**
 * Resolve a rental price for a given duration.
 * Prefers an exact day match for the bike category (or all-category rates),
 * otherwise falls back to (cheapest 1-day rate) × days.
 */
export function resolveRentalPrice(
  rates: RateLike[],
  days: number,
  category?: RentalCategory | null
): { unitPrice: number; totalPrice: number; matchedDays: number } | null {
  const active = rates.filter((r) => r.isActive !== false && r.days > 0 && r.price >= 0);
  if (active.length === 0) return null;

  const forCategory = (r: RateLike) =>
    r.category == null || (category != null && r.category === category);

  const exact =
    active.find((r) => r.days === days && r.category === category) ??
    active.find((r) => r.days === days && r.category == null);

  if (exact) {
    return { unitPrice: exact.price, totalPrice: exact.price, matchedDays: exact.days };
  }

  const dailyCandidates = active
    .filter((r) => r.days === 1 && forCategory(r))
    .sort((a, b) => a.price - b.price);

  const daily = dailyCandidates[0] ?? active.filter((r) => r.days === 1).sort((a, b) => a.price - b.price)[0];

  if (daily) {
    const total = Math.round(daily.price * days * 100) / 100;
    return { unitPrice: daily.price, totalPrice: total, matchedDays: 1 };
  }

  // Closest shorter package, then prorate remaining days from that package's per-day rate
  const packages = active
    .filter(forCategory)
    .filter((r) => r.days <= days)
    .sort((a, b) => b.days - a.days || a.price - b.price);

  const best = packages[0] ?? active.filter(forCategory).sort((a, b) => a.days - b.days || a.price - b.price)[0];
  if (!best) return null;

  const perDay = best.price / best.days;
  const total = Math.round(perDay * days * 100) / 100;
  return { unitPrice: Math.round(perDay * 100) / 100, totalPrice: total, matchedDays: best.days };
}
