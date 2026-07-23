import { customerHasSmsChatAccess, findActiveJobIdForCustomer } from "@/lib/chat-session";
import { getCustomerChatUrl, getCustomerStatusUrl } from "@/lib/job-customer-access";
import { getShopAppUrl } from "@/lib/env";
import { formatPhoneDisplay } from "@/lib/phone";
import { customerHasPushTokens } from "@/lib/push";
import { getConfiguredSmsSender } from "@/lib/sms";

export type ChatCustomerReminderDelivery = {
  smsReplyAvailable: boolean;
  shopSmsNumber: string | null;
  webChatUrl: string | null;
  statusUrl: string | null;
  customerHasApp: boolean;
};

export async function getChatCustomerReminderDelivery(
  shopId: string,
  shopSubdomain: string | null,
  customerId: string
): Promise<ChatCustomerReminderDelivery | null> {
  const shopBaseUrl = getShopAppUrl(shopSubdomain);
  if (!shopBaseUrl) return null;

  const activeJobId = await findActiveJobIdForCustomer(shopId, customerId);
  const smsReplyAvailable = await customerHasSmsChatAccess(shopId, customerId);
  const sender = getConfiguredSmsSender();

  const customerHasApp = await customerHasPushTokens(shopId, customerId);

  return {
    smsReplyAvailable,
    shopSmsNumber: sender ? formatPhoneDisplay(sender) : null,
    webChatUrl: activeJobId
      ? getCustomerChatUrl(activeJobId, shopId, shopSubdomain)
      : `${shopBaseUrl}/chat/c`,
    statusUrl: activeJobId ? getCustomerStatusUrl(activeJobId, shopId, shopSubdomain) : null,
    customerHasApp,
  };
}
