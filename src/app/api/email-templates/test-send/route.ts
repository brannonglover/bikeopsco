import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { sendEmailTemplateTestEmail } from "@/lib/email";

const bodySchema = z.object({
  slug: z.string().min(1),
  to: z.string().email(),
});

/**
 * POST { slug, to } — send a test customer email for a template (preview merge data + full shell).
 * Staff of this shop only, and only to a staff address of this shop: shop
 * sign-up is open, so an arbitrary recipient would make this a way to send
 * mail from our domain to anyone.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const json = await request.json();
    const { slug, to } = bodySchema.parse(json);
    const staff = await prisma.user.findFirst({
      where: { shopId: auth.shopId, email: { equals: to.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (!staff) {
      return NextResponse.json(
        { error: "Test emails can only be sent to a staff email address for this shop." },
        { status: 400 }
      );
    }
    const result = await sendEmailTemplateTestEmail(auth.shopId, slug, to);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: e.flatten() }, { status: 400 });
    }
    console.error("POST /api/email-templates/test-send", e);
    return NextResponse.json({ error: "Test send failed" }, { status: 500 });
  }
}
