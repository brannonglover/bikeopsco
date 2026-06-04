import { NextRequest, NextResponse } from "next/server";
import { customerHasSmsChatAccess, getCustomerIdForActiveJobAccess } from "@/lib/chat-session";
import { getChatCustomerReminderDelivery } from "@/lib/chat-reminder-delivery";
import { getJobCustomerAccessFromRequest } from "@/lib/job-customer-access";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** How a customer with an active repair can reply (SMS, app, web). */
export async function GET(request: NextRequest) {
  try {
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }

    const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    }

    const access = getJobCustomerAccessFromRequest(request);
    const customerId = await getCustomerIdForActiveJobAccess(shop.id, jobId, access);
    if (!customerId) {
      return NextResponse.json({ error: "invalid_job" }, { status: 404 });
    }

    const delivery = await getChatCustomerReminderDelivery(
      shop.id,
      shop.subdomain,
      customerId
    );
    if (!delivery) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }

    const smsReplyAvailable = await customerHasSmsChatAccess(shop.id, customerId);

    return NextResponse.json({
      smsReplyAvailable,
      shopSmsNumber: delivery.shopSmsNumber,
      webChatUrl: delivery.webChatUrl,
      statusUrl: delivery.statusUrl,
      customerHasApp: delivery.customerHasApp,
    });
  } catch (error) {
    console.error("GET /api/chat/reminder-hint error:", error);
    return NextResponse.json({ error: "Failed to load hint" }, { status: 500 });
  }
}
