import { NextRequest } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";
import {
  getStaffConversationMessagesFingerprint,
  loadStaffConversationMessages,
} from "@/lib/chat/staff-conversation-messages";
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
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return new Response("Chat is disabled", { status: 404 });
    }

    ({ id: conversationId } = await params);

    return createPollingSseResponse({
      signal: request.signal,
      getFingerprint: () =>
        getStaffConversationMessagesFingerprint(shop.id, conversationId!),
      getPayload: async () => {
        const payload = await loadStaffConversationMessages(shop.id, conversationId!);
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
