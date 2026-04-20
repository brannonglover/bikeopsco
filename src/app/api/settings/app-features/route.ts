import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { getAppFeatures, upsertAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  bookingsEnabled: z.boolean().optional(),
  maxActiveBikes: z.number().int().min(0).max(200).optional(),
  collectionServiceEnabled: z.boolean().optional(),
  collectionRadiusMiles: z.number().min(0.1).max(100).optional(),
  collectionFeeRegular: z.number().min(0).max(10000).optional(),
  collectionFeeEbike: z.number().min(0).max(10000).optional(),
  notifyCustomerEnabled: z.boolean().optional(),
  chatEnabled: z.boolean().optional(),
  reviewsEnabled: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getAppFeatures());
}

export async function PUT(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);
    return NextResponse.json(await upsertAppFeatures(data));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PUT /api/settings/app-features error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
