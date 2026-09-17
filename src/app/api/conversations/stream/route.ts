import { NextRequest } from "next/server";
import { isChatEnabled } from "@/lib/app-settings";
import {
  getStaffConversationsFingerprint,
  loadStaffConversations,
} from "@/lib/chat/staff-conversations";
import { createPollingSseResponse } from "@/lib/sse";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    if (!(await isChatEnabled(shop.id))) {
      return new Response("Chat is disabled", { status: 404 });
    }

    return createPollingSseResponse({
      signal: request.signal,
      getFingerprint: () => getStaffConversationsFingerprint(shop.id),
      getPayload: () => loadStaffConversations(shop.id),
    });
  } catch (error) {
    console.error("GET /api/conversations/stream error:", error);
    return new Response("Failed to open stream", { status: 500 });
  }
}
