import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  isCatalogConfigured,
  recordCatalogVerification,
  SLOT_META,
  withdrawCatalogVerification,
  type CatalogComponentSlot,
} from "@/lib/bike-catalog-admin";

export const dynamic = "force-dynamic";

const slotSchema = z
  .string()
  .refine((s) => s in SLOT_META, "Unknown slot")
  .transform((s) => s as CatalogComponentSlot);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify"),
    identity: z.boolean(),
    slots: z.array(slotSchema),
    basis: z.string().trim().min(3, "Say what this was checked against"),
  }),
  z.object({
    action: z.literal("withdraw"),
    identity: z.boolean(),
    slots: z.array(slotSchema),
  }),
]);

/** Record (or withdraw) an admin's verification of a build and/or its parts. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;
  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 }
    );
  }
  const body = parsed.data;
  if (!body.identity && body.slots.length === 0) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }

  const bike =
    body.action === "verify"
      ? await recordCatalogVerification(params.id, {
          identity: body.identity,
          slots: body.slots,
          basis: body.basis,
          verifiedBy: auth.session.email,
        })
      : await withdrawCatalogVerification(params.id, { identity: body.identity, slots: body.slots });
  if (!bike) return NextResponse.json({ error: "Bike not found" }, { status: 404 });
  return NextResponse.json({ bike });
}
