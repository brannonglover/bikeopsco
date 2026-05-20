import "server-only";

import { encodeCollectionWindowPairForStorage } from "@/lib/collection-window-storage";
import { getShopTimezone } from "@/lib/shop-timezone";

type WindowFields = {
  collectionWindowStart?: string | null;
  collectionWindowEnd?: string | null;
  collectionReturnWindowStart?: string | null;
  collectionReturnWindowEnd?: string | null;
};

/**
 * Converts collection window fields from form input (HH:mm or ISO) to UTC ISO for storage.
 */
export async function normalizeJobCollectionWindowsForStorage(
  shopId: string,
  fields: WindowFields,
  referenceDates: {
    dropOffDate?: Date | string | null;
    pickupDate?: Date | string | null;
  }
): Promise<WindowFields> {
  const tz = await getShopTimezone(shopId);
  const pickup = encodeCollectionWindowPairForStorage(
    fields.collectionWindowStart,
    fields.collectionWindowEnd,
    referenceDates.dropOffDate,
    tz
  );
  const returnWin = encodeCollectionWindowPairForStorage(
    fields.collectionReturnWindowStart,
    fields.collectionReturnWindowEnd,
    referenceDates.pickupDate,
    tz
  );

  const out: WindowFields = {};
  if (fields.collectionWindowStart !== undefined) out.collectionWindowStart = pickup.start;
  if (fields.collectionWindowEnd !== undefined) out.collectionWindowEnd = pickup.end;
  if (fields.collectionReturnWindowStart !== undefined) {
    out.collectionReturnWindowStart = returnWin.start;
  }
  if (fields.collectionReturnWindowEnd !== undefined) {
    out.collectionReturnWindowEnd = returnWin.end;
  }
  return out;
}
