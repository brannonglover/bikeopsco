import { NextRequest } from "next/server";
import { getCustomerFromSession } from "@/lib/chat-session";
import {
  getCustomerConversationMessagesFingerprint,
  loadCustomerConversationMessages,
} from "@/lib/chat/customer-conversation-messages";
import { getAppFeatures } from "@/lib/app-settings";
import { createPollingSseResponse } from "@/lib/sse";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return new Response("Chat is disabled", { status: 404 });
    }

    const customerId = await getCustomerFromSession();
    if (!customerId) {
      return new Response("Not signed in", { status: 401 });
    }

    return createPollingSseResponse({
      signal: request.signal,
      getFingerprint: () =>
        getCustomerConversationMessagesFingerprint(shop.id, customerId),
      getPayload: () => loadCustomerConversationMessages(shop.id, customerId),
    });
  } catch (error) {
    console.error("GET /api/chat/conversation/messages/stream error:", error);
    return new Response("Failed to open stream", { status: 500 });
  }
}
