import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import {
  importWebsiteKnowledge,
  WebsiteImportError,
} from "@/lib/ai/knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const importSchema = z.object({
  websiteUrl: z.string().trim().min(1).max(2048),
});

/**
 * Reads a shop's website and hands the text back for staff to review.
 *
 * Deliberately does not save: the imported text goes into the editor, and
 * nothing reaches a customer until someone has read it and pressed save.
 */
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { websiteUrl } = importSchema.parse(await request.json());
    const result = await importWebsiteKnowledge(websiteUrl);
    return NextResponse.json({
      websiteUrl: result.url,
      knowledge: result.text,
      pages: result.pages,
    });
  } catch (error) {
    if (error instanceof WebsiteImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter a website address." }, { status: 400 });
    }
    console.error("POST /api/settings/ai-assistant/import error:", error);
    return NextResponse.json(
      { error: "Couldn't read that website. Try again, or paste the details in by hand." },
      { status: 500 }
    );
  }
}
