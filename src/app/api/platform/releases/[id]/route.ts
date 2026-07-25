import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { serializeRelease, updatePlatformRelease } from "@/lib/platform-releases";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  bullets: z.array(z.string().trim().min(1).max(500)).min(1).max(20).optional(),
  status: z.enum(["draft", "published", "discarded"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
  }

  const result = await updatePlatformRelease(id, parsed.data);
  if (!result.ok) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }
    if (result.error === "empty_bullets") {
      return NextResponse.json({ error: "At least one bullet is required" }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not update release" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, release: serializeRelease(result.release) });
}
