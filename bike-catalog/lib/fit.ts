import type { CatalogComponentSlot } from "../generated/client";

/**
 * Parts where a replacement has to match a standard on the frame, fork or
 * wheels — get it wrong and the new part doesn't fit. For these, knowing what
 * the bike came with isn't enough to order: the standard has to be confirmed.
 *
 * This is deliberately only about *identifying* risk. The factory spec says
 * what was fitted; it never says which replacements fit. That (a future
 * replacement-compatibility table keyed by build + slot) is separate.
 */
export const FIT_CRITICAL: Partial<Record<CatalogComponentSlot, string>> = {
  BOTTOM_BRACKET: "bottom bracket shell standard and width",
  CRANKSET: "spindle interface and chainline",
  CASSETTE: "freehub body and speed count",
  CHAIN: "speed count",
  REAR_DERAILLEUR: "hanger, speed count and cassette range",
  FRONT_DERAILLEUR: "mount type and clamp size",
  DERAILLEUR_HANGER: "hanger shape (frame-specific)",
  AXLE: "axle type and hub spacing",
  FRONT_HUB: "hub spacing, axle and rotor mount",
  REAR_HUB: "hub spacing, axle, freehub and rotor mount",
  WHEEL_SIZE: "wheel diameter",
  MAX_TIRE_WIDTH: "frame and fork tire clearance",
  HEADSET: "head tube and steerer dimensions",
  FORK: "steerer, axle, wheel size and travel",
  REAR_SHOCK: "eye-to-eye length, stroke and mounting hardware",
  BRAKES: "caliper mount standard",
  DISC_ROTORS: "rotor size, mount and brake adapter",
  SEATPOST: "seatpost diameter",
};

export type FitCheck = {
  fitCritical: boolean;
  /** What a replacement has to match, when fitCritical. */
  fitNote: string | null;
  /**
   * The factory value isn't confirmed — check the bike before ordering.
   * Verified parts aren't flagged; unverified ones (sourced, approximate or
   * typed by an admin) are.
   */
  checkBeforeOrdering: boolean;
};

export function fitCheck(slot: string, factoryPartVerified: boolean): FitCheck {
  const note = FIT_CRITICAL[slot as CatalogComponentSlot] ?? null;
  return {
    fitCritical: note != null,
    fitNote: note,
    checkBeforeOrdering: note != null && !factoryPartVerified,
  };
}
