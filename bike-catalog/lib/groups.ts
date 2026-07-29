import type { CatalogBikeWithRelations } from "./match";
import { SLOT_META, type SpecGroupId } from "./slots";

export type BikeSpecItem = {
  slot: string;
  label: string;
  value: string;
  detail?: string;
  visibility: "VISUAL" | "INTERNAL" | "STANDARD";
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
  year: number | null;
  category: string | null;
  subcategory: string | null;
  url: string | null;
  thumbnailUrl: string | null;
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

export function toMatchedCatalogBike(bike: CatalogBikeWithRelations): MatchedCatalogBike {
  return {
    id: bike.id,
    maker: bike.brand.name,
    model: bike.model,
    family: bike.family,
    year: bike.year,
    category: bike.category,
    subcategory: bike.subcategory,
    url: bike.sourceUrl,
    thumbnailUrl: bike.thumbnailUrl,
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
