import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { chatChannelName } from "@/lib/realtime/chat-events";
import { jobChannelName } from "@/lib/realtime/job-events";
import { mintRealtimeToken } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

/**
 * GET /api/realtime/token — short-lived Supabase Realtime credentials for the
 * signed-in staff user.
 *
 * Takes no input on purpose. The shop is resolved by `requireStaffShop`, which
 * reads the NextAuth session and additionally checks it against the shop the
 * request host resolves to, so a browser cannot ask for a different tenant's
 * channel by editing a request. The channel names are returned rather than
 * built client-side for the same reason.
 *
 * Both staff channels are issued from one token: the same `shop_id` claim
 * authorizes the jobs topic and the chat topic, and the RLS policy on
 * `realtime.messages` allows exactly those two for that shop.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  const minted = await mintRealtimeToken({
    userId: auth.userId,
    shopId: auth.shopId,
  });

  if (!minted) {
    return NextResponse.json(
      { error: "Realtime is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      token: minted.token,
      expiresAt: minted.expiresAt,
      shopId: auth.shopId,
      // `channel` is the jobs topic, kept under its original name so existing
      // clients keep working; `chatChannel` was added alongside it.
      channel: jobChannelName(auth.shopId),
      chatChannel: chatChannelName(auth.shopId),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
