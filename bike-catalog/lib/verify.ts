import type { CatalogComponentSlot } from "../generated/client";
import { catalogPrisma } from "./db";

/**
 * Verification is a person's recorded statement, never a side effect of an
 * edit or an approval.
 *
 * - Build (identity) verified: an admin confirmed this row's brand, model,
 *   trim and years against a cited source. It sets specStatus VERIFIED and
 *   says nothing about any part.
 * - Part verified: an admin compared that part's exact value (and standard)
 *   with a cited source for this build and year. It confirms the factory part
 *   only — not which replacement parts fit.
 *
 * Each carries who, when and what it was checked against. Changing a verified
 * value (or a verified build's identity) clears it — see upsert.ts.
 */

export type VerificationInput = {
  /** Confirm brand, model, trim and years. */
  identity: boolean;
  /** Parts whose saved value was checked. */
  slots: CatalogComponentSlot[];
  /** What it was checked against: a URL, or e.g. "Inspected the bike in the shop". */
  basis: string;
  /** The admin, by email. */
  verifiedBy: string;
};

export async function recordCatalogVerification(bikeId: string, input: VerificationInput) {
  const basis = input.basis.trim();
  if (!basis) throw new Error("Say what this was checked against");
  if (!input.identity && input.slots.length === 0) throw new Error("Nothing selected to verify");

  const now = new Date();
  return catalogPrisma.$transaction(async (tx) => {
    const bike = await tx.catalogBike.findUnique({ where: { id: bikeId }, select: { id: true } });
    if (!bike) return null;
    if (input.identity) {
      await tx.catalogBike.update({
        where: { id: bikeId },
        data: {
          specStatus: "VERIFIED",
          verifiedAt: now,
          verifiedBy: input.verifiedBy,
          verificationNote: basis,
        },
      });
    }
    if (input.slots.length > 0) {
      await tx.catalogComponent.updateMany({
        where: { bikeId, slot: { in: input.slots } },
        data: { verifiedAt: now, verifiedBy: input.verifiedBy, verifiedAgainst: basis },
      });
    }
    return tx.catalogBike.findUnique({
      where: { id: bikeId },
      include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
    });
  });
}

/** Take back a verification (identity, parts, or both). */
export async function withdrawCatalogVerification(
  bikeId: string,
  input: { identity: boolean; slots: CatalogComponentSlot[] }
) {
  return catalogPrisma.$transaction(async (tx) => {
    const bike = await tx.catalogBike.findUnique({
      where: { id: bikeId },
      include: { components: { select: { source: true } } },
    });
    if (!bike) return null;
    if (input.identity && bike.specStatus === "VERIFIED") {
      // Back to what the row is without a person's word: sourced if any part
      // has a cited source, else approximate.
      const sourced = bike.components.some((c) => c.source === "MANUFACTURER" || c.source === "THIRD_PARTY");
      await tx.catalogBike.update({
        where: { id: bikeId },
        data: {
          specStatus: sourced ? "SOURCED" : "APPROXIMATE",
          verifiedAt: null,
          verifiedBy: null,
          verificationNote: null,
        },
      });
    }
    if (input.slots.length > 0) {
      await tx.catalogComponent.updateMany({
        where: { bikeId, slot: { in: input.slots } },
        data: { verifiedAt: null, verifiedBy: null, verifiedAgainst: null },
      });
    }
    return tx.catalogBike.findUnique({
      where: { id: bikeId },
      include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
    });
  });
}
