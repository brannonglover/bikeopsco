import { NextRequest } from "next/server";
import { isChatEnabled } from "@/lib/app-settings";
import {
  getStaffConversationMessagesFingerprint,
  loadStaffConversationMessages,
} from "@/lib/chat/staff-conversation-messages";
import { resolveStaffConversationForRead } from "@/lib/conversation";
import { parseMessagePageOptions } from "@/lib/chat/message-page";
import { createPollingSseResponse } from "@/lib/sse";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let conversationId: string | null = null;
  try {
    const shop = await requireCurrentShop();
    if (!(await isChatEnabled(shop.id))) {
      return new Response("Chat is disabled", { status: 404 });
    }

    ({ id: conversationId } = await params);

    const resolved = await resolveStaffConversationForRead(shop.id, conversationId!);
    if (!resolved) {
      return new Response("Conversation not found", { status: 404 });
    }

    const resolvedId = resolved.id;
    // Stream the same bounded page the client fetches, not the whole history —
    // the payload is re-sent on every change and on every 55s reconnect.
    const page = parseMessagePageOptions(request.nextUrl.searchParams);

    return createPollingSseResponse({
      signal: request.signal,
      getFingerprint: () =>
        getStaffConversationMessagesFingerprint(shop.id, resolvedId),
      getPayload: async () => {
        const payload = await loadStaffConversationMessages(
          shop.id,
          resolvedId,
          page
        );
        if (!payload) {
          throw new Error("Conversation not found");
        }
        return payload;
      },
    });
  } catch (error) {
    console.error("GET /api/conversations/[id]/messages/stream error:", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Failed to open stream", { status: 500 });
  }
}
