import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { deletePlatformShop } from "@/lib/platform-shops";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await deletePlatformShop(id);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Shop not found." }, { status: 404 });
    }
    if (result.reason === "protected") {
      return NextResponse.json({ error: result.message ?? "This shop cannot be deleted." }, { status: 403 });
    }
    return NextResponse.json(
      { error: result.message ?? "Could not delete shop." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
