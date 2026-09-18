import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findOrCreateProvisionalCustomer } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import { requireCurrentShop } from "@/lib/shop";
import {
  buildSmsConsentUpdate,
  SMS_CONSENT_NEVER_SET,
  SMS_CONSENT_SOURCES,
} from "@/lib/sms-consent";

export const dynamic = "force-dynamic";

const customerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
  notes: true,
  provisional: true,
  smsConsent: true,
  smsConsentSource: true,
} as const;

/**
 * Open a chat thread for a call, so staff can answer a caller by text.
 *
 * A caller who isn't on file arrives with `customerId: null` and no
 * conversation — there is nothing to reply into, which is why the call log's
 * message action did nothing for strangers. This creates the placeholder
 * contact and thread on demand (never automatically on every inbound call, so
 * wrong numbers and spam don't fill the customer list) and links them back onto
 * the call record.
 *
 * Returns the conversation to open. Safe to call repeatedly — an already-linked
 * call resolves to its existing thread.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;

    const call = await prisma.call.findFirst({
      where: { id, shopId: shop.id },
      select: {
        id: true,
        customerId: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
      },
    });
    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    // The customer's number is whichever end of the call wasn't the shop.
    const counterparty =
      call.direction === "INBOUND" ? call.fromNumber : call.toNumber;
    const phoneE164 = counterparty ? normalizePhone(counterparty) : null;

    let customerId = call.customerId;
    let createdCustomer = false;

    if (!customerId) {
      if (!phoneE164) {
        return NextResponse.json(
          { error: "This call has no usable phone number to text" },
          { status: 400 }
        );
      }
      const resolved = await findOrCreateProvisionalCustomer(
        shop.id,
        phoneE164,
        SMS_CONSENT_SOURCES.INBOUND_CALL
      );
      customerId = resolved.customerId;
      createdCustomer = resolved.created;
    }

    // An existing contact keeps the consent it already had, except when it was
    // never explicitly set — then answering their call records why we may text
    // back. Scoped to SMS_CONSENT_NEVER_SET so a prior STOP stays an opt-out.
    if (!createdCustomer) {
      await prisma.customer.updateMany({
        where: { id: customerId, shopId: shop.id, ...SMS_CONSENT_NEVER_SET },
        data: buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.INBOUND_CALL),
      });
    }

    const conversation = await findOrCreateGeneralConversation(
      shop.id,
      customerId
    );

    // Backfill the call record so the log shows the contact from now on.
    if (call.customerId !== customerId) {
      await prisma.call.update({
        where: { id: call.id },
        data: { customerId, conversationId: conversation.id },
      });
    } else {
      await prisma.call.update({
        where: { id: call.id },
        data: { conversationId: conversation.id },
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: customerSelect,
    });

    return NextResponse.json({
      conversationId: conversation.id,
      customerId,
      customer,
      createdCustomer,
    });
  } catch (error) {
    console.error("POST /api/calls/[id]/conversation error:", error);
    return NextResponse.json(
      { error: "Failed to open a conversation for this call" },
      { status: 500 }
    );
  }
}
