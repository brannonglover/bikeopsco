/**
 * App-facing bike catalog client. All catalog DB access from the Next.js app
 * should go through this module — never join catalog tables into shop queries.
 */
import { isCatalogConfigured } from "../../bike-catalog/lib/db";
import {
  getCatalogBikeById,
  matchCatalogBike,
  type MatchResult,
} from "../../bike-catalog/lib/match";
import {
  toMatchedCatalogBike,
  toSpecsPayload,
  type BikeSpecsPayload,
  type MatchedCatalogBike,
  type BikeSpecGroup,
  type BikeSpecItem,
} from "../../bike-catalog/lib/groups";

export type {
  BikeSpecsPayload,
  MatchedCatalogBike,
  BikeSpecGroup,
  BikeSpecItem,
  MatchResult,
};

export { isCatalogConfigured, getCatalogBikeById, matchCatalogBike, toMatchedCatalogBike, toSpecsPayload };

export async function fetchSpecsForJobBike(
  make: string,
  model: string | null,
  year: number | null,
  existingCatalogBikeId?: string | null
): Promise<
  | { ok: true; catalogBikeId: string; specs: BikeSpecsPayload }
  | {
      ok: false;
      reason: "not_configured" | "no_match" | "low_confidence";
      candidates?: MatchedCatalogBike[];
      message?: string;
    }
> {
  if (!isCatalogConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Bike catalog database is not configured",
    };
  }

  try {
    if (existingCatalogBikeId) {
      const bike = await getCatalogBikeById(existingCatalogBikeId);
      if (bike) {
        return { ok: true, catalogBikeId: bike.id, specs: toSpecsPayload(bike) };
      }
    }

    const match = await matchCatalogBike(make, model, year);
    if (!match.ok) {
      return {
        ok: false,
        reason:
          match.reason === "not_configured"
            ? "not_configured"
            : match.reason === "no_results"
              ? "no_match"
              : "low_confidence",
        candidates: match.candidates?.map(toMatchedCatalogBike),
        message: match.message,
      };
    }

    return {
      ok: true,
      catalogBikeId: match.bike.id,
      specs: toSpecsPayload(match.bike),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch bike specs";
    return { ok: false, reason: "no_match", message };
  }
}
