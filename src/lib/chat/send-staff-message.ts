import "server-only";

import { prisma } from "@/lib/db";
import { attachmentNotificationLabel } from "@/lib/chat-media";
import {
  customerHasSmsChatAccess,
  findActiveJobIdForCustomer,
} from "@/lib/chat-session";
import { getConfiguredSmsProvider, sendChatStaffSms } from "@/lib/sms";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";
import { customerHasPushTokens, sendPushToCustomer } from "@/lib/push";

type ShopContext = {
  id: string;
  name: string;
  subdomain: string | null;
};

type CustomerContext = {
  id: string;
  phone: string | null;
  smsConsent: boolean;
  smsConsentUpdatedAt: Date | string | null;
};

type MessageContext = {
  id: string;
  conversationId: string;
  body: string | null;
  attachments: { url: string; mimeType: string }[];
};

/**
 * Delivers a message the shop has sent to a customer: one text or push,
 * never both, with the SMS delivery result written back onto the message row.
 *
 * Extracted from the staff send route so the AI assistant reaches customers
 * through exactly the same path — consent checks, provider selection, and
 * delivery bookkeeping included. A second implementation would drift, and the
 * half that drifted would be the one texting people unsupervised.
 */
export async function deliverStaffMessage({
  shop,
  customer,
  message,
  /**
   * Skips the "does this customer have an open thread or active job" check,
   * but never the consent check.
   *
   * The assistant's first text answers a call the customer just placed to the
   * shop, so there is no open thread yet for the gate to find — the call is
   * the thread. An explicit opt-out still stops it: only the access gate is
   * bypassed, and no consent is recorded on the customer's behalf.
   */
  bypassChatAccessGate = false,
}: {
  shop: ShopContext;
  customer: CustomerContext;
  message: MessageContext;
  bypassChatAccessGate?: boolean;
}): Promise<void> {
  const hasText = Boolean(message.body?.trim());
  const hasAttachments = message.attachments.length > 0;
  if (!hasText && !hasAttachments) return;

  // App users get a push instead of a parallel SMS for the same message.
  const preferAppPush = await customerHasPushTokens(shop.id, customer.id);

  const smsAllowed =
    !preferAppPush &&
    Boolean(customer.phone) &&
    getEffectiveSmsConsent(customer) &&
    (bypassChatAccessGate ||
      (await customerHasSmsChatAccess(shop.id, customer.id)));

  if (smsAllowed) {
    const activeJobId = await findActiveJobIdForCustomer(shop.id, customer.id);
    const attachmentOnly = !hasText && hasAttachments;

    const result = await sendChatStaffSms(
      customer.phone!,
      attachmentOnly ? "" : message.body!.trim(),
      {
        attachmentOnly,
        includeChatUrl: attachmentOnly || hasAttachments,
        shopSubdomain: shop.subdomain ?? undefined,
        messageId: message.id,
        jobId: activeJobId ?? undefined,
        shopId: shop.id,
        attachments: message.attachments,
      }
    ).catch((error) => {
      console.error("[chat] staff SMS send failed:", error);
      return null;
    });

    if (result) {
      await prisma.message
        .update({
          where: { id: message.id },
          data: {
            smsProvider: result.provider ?? getConfiguredSmsProvider(),
            smsSid: result.externalMessageId,
            smsDeliveryStatus: result.ok ? result.externalStatus ?? "SENT" : "FAILED",
            smsDeliveryStatusName: result.ok
              ? result.externalStatusName ?? null
              : "SEND_FAILED",
            smsDeliveryStatusDescription: result.ok
              ? result.externalStatusDescription ?? null
              : result.error ?? null,
            smsDeliveryError: result.ok ? null : result.error ?? "SMS send failed",
          },
        })
        .catch((error) =>
          console.error("[chat] SMS delivery persistence failed:", error)
        );
    }
  }

  const pushBody = hasText
    ? message.body!.trim()
    : attachmentNotificationLabel(
        message.attachments.map((a) => ({ mimeType: a.mimeType }))
      );

  await sendPushToCustomer(shop.id, customer.id, {
    title: shop.name,
    body: pushBody,
    data: {
      type: "new_message",
      conversationId: message.conversationId,
      messageId: message.id,
    },
  }).catch((error) => console.error("[chat] push notify customer failed:", error));
}
