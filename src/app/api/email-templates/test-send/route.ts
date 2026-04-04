import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { sendEmailTemplateTestEmail } from "@/lib/email";

const bodySchema = z.object({
  slug: z.string().min(1),
  to: z.string().email(),
});

/**
 * POST { slug, to } — send a test customer email for a template (preview merge data + full shell).
 * Staff session required.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const { slug, to } = bodySchema.parse(json);
    const result = await sendEmailTemplateTestEmail(slug, to);
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
