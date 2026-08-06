export const RENTAL_CATEGORIES = [
  "MOUNTAIN",
  "HYBRID",
  "ROAD",
  "ELECTRIC",
  "OTHER",
] as const;

export type RentalCategory = (typeof RENTAL_CATEGORIES)[number];

export const RENTAL_CATEGORY_LABELS: Record<RentalCategory, string> = {
  MOUNTAIN: "Mountain Bikes",
  HYBRID: "Hybrid Bikes",
  ROAD: "Road Bikes",
  ELECTRIC: "Electric Bikes",
  OTHER: "Other",
};

export const RENTAL_STATUSES = [
  "REQUESTED",
  "SCHEDULED",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

export type RentalReservationStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Record<RentalReservationStatus, string> = {
  REQUESTED: "Requested",
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function rentalDaysBetween(startDate: Date, endDate: Date): number {
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Math.max(1, days);
}

export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("Invalid date");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  if (value && typeof value === "object" && "toNumber" in value) {
    return Number((value as { toNumber: () => number }).toNumber());
  }
  return Number(value ?? 0);
}
