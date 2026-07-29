import type { CatalogComponentSlot, ComponentVisibility } from "../generated/client";

export type SpecGroupId = "drivetrain" | "wheels" | "brakes" | "frame" | "cockpit" | "standards";

export const SLOT_META: Record<
  CatalogComponentSlot,
  {
    label: string;
    group: SpecGroupId;
    groupTitle: string;
    visibility: ComponentVisibility;
    sortOrder: number;
  }
> = {
  SHIFTING: { label: "Shifting", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 10 },
  GEARING_TYPE: { label: "Gearing type", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 20 },
  CHAINRINGS_COGS: { label: "Chainrings / cogs", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 30 },
  SHIFTERS: { label: "Shifters", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 40 },
  REAR_DERAILLEUR: { label: "Rear derailleur", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 50 },
  FRONT_DERAILLEUR: { label: "Front derailleur", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 60 },
  CRANKSET: { label: "Crankset", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 70 },
  CASSETTE: { label: "Cassette", group: "drivetrain", groupTitle: "Drivetrain", visibility: "VISUAL", sortOrder: 80 },
  CHAIN: { label: "Chain", group: "drivetrain", groupTitle: "Drivetrain", visibility: "INTERNAL", sortOrder: 90 },
  BOTTOM_BRACKET: { label: "Bottom bracket", group: "drivetrain", groupTitle: "Drivetrain", visibility: "INTERNAL", sortOrder: 100 },
  WHEEL_SIZE: { label: "Wheel size", group: "wheels", groupTitle: "Wheels & tires", visibility: "VISUAL", sortOrder: 10 },
  RIMS: { label: "Rims", group: "wheels", groupTitle: "Wheels & tires", visibility: "VISUAL", sortOrder: 20 },
  TIRES: { label: "Tires", group: "wheels", groupTitle: "Wheels & tires", visibility: "VISUAL", sortOrder: 30 },
  FRONT_HUB: { label: "Front hub", group: "wheels", groupTitle: "Wheels & tires", visibility: "INTERNAL", sortOrder: 40 },
  REAR_HUB: { label: "Rear hub", group: "wheels", groupTitle: "Wheels & tires", visibility: "INTERNAL", sortOrder: 50 },
  SPOKES: { label: "Spokes", group: "wheels", groupTitle: "Wheels & tires", visibility: "INTERNAL", sortOrder: 60 },
  MAX_TIRE_WIDTH: { label: "Max tire width", group: "wheels", groupTitle: "Wheels & tires", visibility: "STANDARD", sortOrder: 70 },
  BRAKES: { label: "Brakes", group: "brakes", groupTitle: "Brakes", visibility: "VISUAL", sortOrder: 10 },
  BRAKE_LEVERS: { label: "Brake levers", group: "brakes", groupTitle: "Brakes", visibility: "VISUAL", sortOrder: 20 },
  DISC_ROTORS: { label: "Disc rotors", group: "brakes", groupTitle: "Brakes", visibility: "VISUAL", sortOrder: 30 },
  FRAME_MATERIAL: { label: "Frame material", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 10 },
  DERAILLEUR_HANGER: { label: "Derailleur hanger", group: "standards", groupTitle: "Standards & fitment", visibility: "STANDARD", sortOrder: 10 },
  FRAME: { label: "Frame", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 20 },
  FORK: { label: "Fork", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 30 },
  HEADSET: { label: "Headset", group: "frame", groupTitle: "Frame & suspension", visibility: "INTERNAL", sortOrder: 40 },
  REAR_SHOCK: { label: "Rear shock", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 50 },
  SUSPENSION: { label: "Suspension", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 60 },
  FRONT_TRAVEL: { label: "Front travel", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 70 },
  REAR_TRAVEL: { label: "Rear travel", group: "frame", groupTitle: "Frame & suspension", visibility: "VISUAL", sortOrder: 80 },
  STEM: { label: "Stem", group: "cockpit", groupTitle: "Cockpit & contact points", visibility: "VISUAL", sortOrder: 10 },
  HANDLEBAR: { label: "Handlebar", group: "cockpit", groupTitle: "Cockpit & contact points", visibility: "VISUAL", sortOrder: 20 },
  GRIPS: { label: "Grips", group: "cockpit", groupTitle: "Cockpit & contact points", visibility: "VISUAL", sortOrder: 30 },
  SADDLE: { label: "Saddle", group: "cockpit", groupTitle: "Cockpit & contact points", visibility: "VISUAL", sortOrder: 40 },
  SEATPOST: { label: "Seatpost", group: "cockpit", groupTitle: "Cockpit & contact points", visibility: "VISUAL", sortOrder: 50 },
  AXLE: { label: "Axle", group: "standards", groupTitle: "Standards & fitment", visibility: "STANDARD", sortOrder: 20 },
};

/** Map common OEM / scraped labels → catalog slots */
export const LABEL_TO_SLOT: Record<string, CatalogComponentSlot> = {
  shifting: "SHIFTING",
  "gear shifting": "SHIFTING",
  gearing: "GEARING_TYPE",
  "gearing type": "GEARING_TYPE",
  drivetrain: "GEARING_TYPE",
  shifters: "SHIFTERS",
  "rear derailleur": "REAR_DERAILLEUR",
  "front derailleur": "FRONT_DERAILLEUR",
  crankset: "CRANKSET",
  crank: "CRANKSET",
  cassette: "CASSETTE",
  chain: "CHAIN",
  "bottom bracket": "BOTTOM_BRACKET",
  bb: "BOTTOM_BRACKET",
  "wheel size": "WHEEL_SIZE",
  wheels: "WHEEL_SIZE",
  rims: "RIMS",
  tires: "TIRES",
  tyre: "TIRES",
  "front hub": "FRONT_HUB",
  "rear hub": "REAR_HUB",
  spokes: "SPOKES",
  "max tire width": "MAX_TIRE_WIDTH",
  "tire clearance": "MAX_TIRE_WIDTH",
  brakes: "BRAKES",
  "brake levers": "BRAKE_LEVERS",
  "disc rotors": "DISC_ROTORS",
  rotors: "DISC_ROTORS",
  "frame material": "FRAME_MATERIAL",
  frame: "FRAME",
  "derailleur hanger": "DERAILLEUR_HANGER",
  hanger: "DERAILLEUR_HANGER",
  fork: "FORK",
  headset: "HEADSET",
  "rear shock": "REAR_SHOCK",
  shock: "REAR_SHOCK",
  suspension: "SUSPENSION",
  "front travel": "FRONT_TRAVEL",
  "rear travel": "REAR_TRAVEL",
  stem: "STEM",
  handlebar: "HANDLEBAR",
  "handlebars": "HANDLEBAR",
  grips: "GRIPS",
  saddle: "SADDLE",
  seatpost: "SEATPOST",
  axle: "AXLE",
};

export function normalizeLabelToSlot(label: string): CatalogComponentSlot | null {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  return LABEL_TO_SLOT[key] ?? null;
}

export function slugify(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p != null && String(p).trim() !== "")
    .map((p) =>
      String(p)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean)
    .join("-");
}
