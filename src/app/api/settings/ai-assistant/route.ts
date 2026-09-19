import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The service description the AI assistant is allowed to quote, and the site it
 * was imported from. Kept off /app-features because it's a body of text staff
 * edit, not a switch — and because the assistant's on/off toggle should stay
 * usable even while this is being rewritten.
 */

/** Generous enough for a small shop's whole site, short of a context problem. */
const MAX_KNOWLEDGE_CHARS = 24_000;

const updateSchema = z.object({
  websiteUrl: z
    .union([z.string().trim().max(2048), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  knowledge: z
    .union([z.string().max(MAX_KNOWLEDGE_CHARS), z.null()])
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
});

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.appSettings.findUnique({
    where: { shopId: token.shopId },
    select: {
      aiAssistantWebsiteUrl: true,
      aiAssistantKnowledge: true,
      aiAssistantKnowledgeAt: true,
    },
  });

  return NextResponse.json({
    websiteUrl: settings?.aiAssistantWebsiteUrl ?? null,
    knowledge: settings?.aiAssistantKnowledge ?? null,
    knowledgeUpdatedAt: settings?.aiAssistantKnowledgeAt?.toISOString() ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { websiteUrl, knowledge } = updateSchema.parse(await request.json());

    const data = {
      ...(websiteUrl !== undefined ? { aiAssistantWebsiteUrl: websiteUrl } : {}),
      ...(knowledge !== undefined
        ? { aiAssistantKnowledge: knowledge, aiAssistantKnowledgeAt: new Date() }
        : {}),
    };

    const updated = await prisma.appSettings.upsert({
      where: { shopId: token.shopId },
      create: { shopId: token.shopId, ...data },
      update: data,
      select: {
        aiAssistantWebsiteUrl: true,
        aiAssistantKnowledge: true,
        aiAssistantKnowledgeAt: true,
      },
    });

    return NextResponse.json({
      websiteUrl: updated.aiAssistantWebsiteUrl,
      knowledge: updated.aiAssistantKnowledge,
      knowledgeUpdatedAt: updated.aiAssistantKnowledgeAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PUT /api/settings/ai-assistant error:", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}
