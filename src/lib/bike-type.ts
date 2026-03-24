import type { BikeType } from "@prisma/client";

/**
 * Heuristic: treat as e-bike when make/model suggests electric / pedal-assist.
 * Explicit bikeType on Bike or JobBike overrides this.
 */
export function inferBikeTypeFromMakeModel(make: string, model: string): BikeType {
  const combined = `${make} ${model}`;
  if (
    /\b(e-?bike|e\s*bike|ebike|electric|pedal\s*assist|bosch|shimano\s*steps|brose|yamaha\s*pw|bafang|mahle|fazua|specialized\s*turbo|super\s*commuter\s*\+)\b/i.test(
      combined
    )
  ) {
    return "E_BIKE";
  }
  return "REGULAR";
}

export function resolveEffectiveBikeType(jb: {
  bikeType: BikeType | null;
  make: string;
  model: string;
  bikeId: string | null;
  bike?: { bikeType: BikeType | null; make: string; model: string } | null;
}): BikeType {
  if (jb.bikeType) return jb.bikeType;
  if (jb.bike) {
    if (jb.bike.bikeType) return jb.bike.bikeType;
    return inferBikeTypeFromMakeModel(jb.bike.make, jb.bike.model);
  }
  return inferBikeTypeFromMakeModel(jb.make, jb.model);
}
