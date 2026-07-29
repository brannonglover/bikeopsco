import type { CatalogComponentSlot } from "../generated/client";
import { SLOT_META } from "./slots";

export type CatalogSlotOption = {
  slot: CatalogComponentSlot;
  label: string;
  group: string;
  groupTitle: string;
  visibility: string;
};

export function listCatalogSlotOptions(): CatalogSlotOption[] {
  return (Object.keys(SLOT_META) as CatalogComponentSlot[]).map((slot) => ({
    slot,
    label: SLOT_META[slot].label,
    group: SLOT_META[slot].group,
    groupTitle: SLOT_META[slot].groupTitle,
    visibility: SLOT_META[slot].visibility,
  }));
}
