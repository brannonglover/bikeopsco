/**
 * Platform-admin helpers for the owned bike catalog.
 * Keep catalog Prisma usage out of shop-tenant routes.
 */
export { catalogPrisma, isCatalogConfigured } from "../../bike-catalog/lib/db";
export {
  upsertCatalogBike,
  deleteCatalogBike,
  updateCatalogBikeMeta,
  replaceCatalogComponents,
  type UpsertBikeInput,
  type UpsertComponentInput,
} from "../../bike-catalog/lib/upsert";
export { listCatalogSlotOptions, type CatalogSlotOption } from "../../bike-catalog/lib/slot-options";
export {
  recordCatalogVerification,
  withdrawCatalogVerification,
} from "../../bike-catalog/lib/verify";
export { SLOT_META } from "../../bike-catalog/lib/slots";
export type { CatalogComponentSlot } from "../../bike-catalog/generated/client";
