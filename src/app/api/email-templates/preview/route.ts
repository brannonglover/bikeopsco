import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildCustomerEmailPreviewDocument } from "@/lib/email";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

function htmlResponse(html: string) {
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      // Allow same-origin framing from the staff app (Email Templates page).
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}

/**
 * GET ?slug=… — preview saved template with Bike Ops shell + sample variables.
 */
export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug?.trim()) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const template = await prisma.emailTemplate.findUnique({
      where: { shopId_slug: { shopId: shop.id, slug: slug.trim() } },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return htmlResponse(await buildCustomerEmailPreviewDocument(template.bodyHtml, shop.id));
  } catch (e) {
    console.error("GET /api/email-templates/preview", e);
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}

const postSchema = z.object({
  bodyHtml: z.string(),
});

/**
 * POST { bodyHtml } — preview arbitrary HTML body (e.g. while editing) with the same shell + samples.
 */
export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const json = await request.json();
    const { bodyHtml } = postSchema.parse(json);
    return htmlResponse(await buildCustomerEmailPreviewDocument(bodyHtml, shop.id));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("POST /api/email-templates/preview", e);
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
