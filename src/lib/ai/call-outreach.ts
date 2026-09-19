import "server-only";

import { prisma } from "@/lib/db";
import { findOrCreateProvisionalCustomer } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import {
  buildSmsConsentUpdate,
  SMS_CONSENT_NEVER_SET,
  SMS_CONSENT_SOURCES,
} from "@/lib/sms-consent";
import { runAssistantTurn, type AssistantTrigger } from "@/lib/ai/assistant";

/**
 * Texts a caller the shop missed.
 *
 * Three Twilio callbacks can describe the same missed call — the voicemail
 * TwiML, the recording callback, and the final status callback — and a
 * transcript may arrive after all of them. Each one calls this; `aiOutreachAt`
 * is claimed in a conditional update so exactly one of them wins the race and
 * the caller is texted once.
 */

/** How long after a call we'll still open with "sorry we missed you". */
const OUTREACH_WINDOW_MS = 60 * 60 * 1000;

export async function startAssistantCallOutreach({
  shopId,
  callId,
  trigger,
}: {
  shopId: string;
  callId: string;
  trigger: Extract<AssistantTrigger, "voicemail" | "missed_call">;
}): Promise<void> {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
      select: { aiAssistantEnabled: true },
    });
    if (!settings?.aiAssistantEnabled) return;

    const call = await prisma.call.findFirst({
      where: { id: callId, shopId },
      select: {
        id: true,
        direction: true,
        customerId: true,
        fromNumber: true,
        answeredAt: true,
        aiOutreachAt: true,
        createdAt: true,
        transcriptionText: true,
      },
    });
    if (!call) return;
    if (call.direction !== "INBOUND") return;
    // Someone picked up. Whatever the caller wanted, they said it to a person.
    if (call.answeredAt) return;
    if (call.aiOutreachAt) return;
    if (Date.now() - call.createdAt.getTime() > OUTREACH_WINDOW_MS) return;
    if (!call.fromNumber) return;

    // Claim the call before doing anything that sends. A second callback
    // arriving mid-turn matches zero rows here and stops.
    const claimed = await prisma.call.updateMany({
      where: { id: call.id, shopId, aiOutreachAt: null },
      data: { aiOutreachAt: new Date() },
    });
    if (claimed.count === 0) return;

    // An unknown caller has no contact record yet — the same provisional
    // profile an unknown texter gets, so staff see one inbox entry either way.
    // Consent is recorded as INBOUND_CALL, not INBOUND_SMS: this caller phoned,
    // and the record should say so.
    const created = call.customerId
      ? null
      : await findOrCreateProvisionalCustomer(
          shopId,
          call.fromNumber,
          SMS_CONSENT_SOURCES.INBOUND_CALL
        );
    const customerId = call.customerId ?? created!.customerId;

    // A caller already on file whose consent was never set gets the same
    // record. Scoped to SMS_CONSENT_NEVER_SET, so someone who has replied STOP
    // — or opted out anywhere else — is not silently opted back in, and is
    // then not texted at all, because deliverStaffMessage checks consent.
    if (call.customerId) {
      await prisma.customer.updateMany({
        where: { id: customerId, shopId, ...SMS_CONSENT_NEVER_SET },
        data: buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.INBOUND_CALL),
      });
    }

    const conversation = await findOrCreateGeneralConversation(shopId, customerId);

    // Backfill the call's links so the log and the thread agree, whichever of
    // them staff open first.
    await prisma.call
      .update({
        where: { id: call.id },
        data: { customerId, conversationId: conversation.id },
      })
      .catch((error) =>
        console.error("[ai] linking call to conversation failed:", error)
      );

    const result = await runAssistantTurn({
      shopId,
      conversationId: conversation.id,
      trigger,
      voicemailTranscript: call.transcriptionText,
    });

    // Release the claim when nothing was sent, so a later callback — the
    // transcript arriving, say — still gets its chance.
    if (!result.ok) {
      await prisma.call
        .updateMany({ where: { id: call.id, shopId }, data: { aiOutreachAt: null } })
        .catch(() => undefined);
    }
  } catch (error) {
    console.error("[ai] call outreach failed:", {
      shopId,
      callId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
