import type { CatalogBikeWithBrand, CatalogBikeWithRelations } from "./match";
import { SLOT_META, type SpecGroupId } from "./slots";
import { formatYearSpan } from "./years";
import { fitCheck } from "./fit";

export type BikeSpecItem = {
  slot: string;
  label: string;
  value: string;
  detail?: string;
  visibility: "VISUAL" | "INTERNAL" | "STANDARD";
  /** Where the factory part came from — see ComponentSource. */
  source: "MANUFACTURER" | "THIRD_PARTY" | "ADMIN" | "APPROXIMATE";
  sourceUrl: string | null;
  /** An admin checked this factory value against `against` (see verify.ts). */
  verified: { at: string; by: string | null; against: string | null } | null;
  /** A replacement must match a standard here (see fit.ts). */
  fitCritical: boolean;
  fitNote: string | null;
  /** Fit-critical and the factory value isn't verified: confirm on the bike before ordering. */
  checkBeforeOrdering: boolean;
};

export type BikeSpecGroup = {
  id: SpecGroupId;
  title: string;
  items: BikeSpecItem[];
};

export type MatchedCatalogBike = {
  id: string;
  maker: string;
  model: string;
  family: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  /** "2019" or "2017–2020" */
  yearLabel: string | null;
  category: string | null;
  subcategory: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  /** APPROXIMATE, SOURCED (web sources, unchecked) or VERIFIED (identity checked by an admin). */
  specStatus: "APPROXIMATE" | "SOURCED" | "VERIFIED";
  identityVerified: { at: string; by: string | null; note: string | null } | null;
};

export type BikeSpecsPayload = {
  matched: MatchedCatalogBike;
  groups: BikeSpecGroup[];
};

const GROUP_TITLES: Record<SpecGroupId, string> = {
  drivetrain: "Drivetrain",
  wheels: "Wheels & tires",
  brakes: "Brakes",
  frame: "Frame & suspension",
  cockpit: "Cockpit & contact points",
  standards: "Standards & fitment",
};

const GROUP_ORDER: SpecGroupId[] = ["drivetrain", "wheels", "brakes", "frame", "cockpit", "standards"];

export function toMatchedCatalogBike(bike: CatalogBikeWithBrand): MatchedCatalogBike {
  return {
    id: bike.id,
    maker: bike.brand.name,
    model: bike.model,
    family: bike.family,
    yearStart: bike.yearStart,
    yearEnd: bike.yearEnd ?? bike.yearStart,
    yearLabel: formatYearSpan(bike),
    category: bike.category,
    subcategory: bike.subcategory,
    url: bike.sourceUrl,
    thumbnailUrl: bike.thumbnailUrl,
    specStatus: bike.specStatus,
    identityVerified:
      bike.specStatus === "VERIFIED" && bike.verifiedAt
        ? { at: bike.verifiedAt.toISOString(), by: bike.verifiedBy, note: bike.verificationNote }
        : null,
  };
}

export function buildSpecGroups(bike: CatalogBikeWithRelations): BikeSpecGroup[] {
  const byGroup = new Map<SpecGroupId, BikeSpecItem[]>();

  for (const component of bike.components) {
    const meta = SLOT_META[component.slot];
    if (!meta) continue;
    const items = byGroup.get(meta.group) ?? [];
    items.push({
      slot: component.slot,
      label: component.label || meta.label,
      value: component.value,
      detail: component.detail ?? (component.standard ? `Standard: ${component.standard}` : undefined),
      visibility: component.visibility,
      source: component.source,
      sourceUrl: component.sourceUrl,
      verified: component.verifiedAt
        ? { at: component.verifiedAt.toISOString(), by: component.verifiedBy, against: component.verifiedAgainst }
        : null,
      ...fitCheck(component.slot, component.verifiedAt != null),
    });
    byGroup.set(meta.group, items);
  }

  return GROUP_ORDER.flatMap((id) => {
    const items = byGroup.get(id);
    if (!items?.length) return [];
    return [{ id, title: GROUP_TITLES[id], items }];
  });
}

export function toSpecsPayload(bike: CatalogBikeWithRelations): BikeSpecsPayload {
  return {
    matched: toMatchedCatalogBike(bike),
    groups: buildSpecGroups(bike),
  };
}
