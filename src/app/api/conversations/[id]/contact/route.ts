import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractContactFromMessages } from "@/lib/contact-extraction";
import {
  resolveStaffConversation,
  resolveStaffConversationForRead,
} from "@/lib/conversation";
import { coerceCustomerPhone } from "@/lib/phone";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Bounds how much history the extractor reads. People introduce themselves in
 * their opening texts, so the oldest messages are the ones that matter.
 */
const SCAN_MESSAGE_LIMIT = 100;

const customerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
  notes: true,
  provisional: true,
} as const;

/** Blank form fields arrive as "" and mean "not provided", not "set to empty". */
const optionalText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed ? trimmed : null;
  });

const saveSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: optionalText,
  email: optionalText.refine(
    (value) => value === null || z.string().email().safeParse(value).success,
    "Enter a valid email address"
  ),
  phone: optionalText,
  address: optionalText,
  notes: optionalText,
});

/**
 * Details for the inbox's "Create contact" form: the contact record behind the
 * thread plus whatever name, email and phone numbers the customer's own
 * messages give up.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;

    const conversation = await resolveStaffConversationForRead(shop.id, id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const customer = await prisma.customer.findFirst({
      where: { id: conversation.customerId, shopId: shop.id },
      select: customerSelect,
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id, sender: "CUSTOMER" },
      orderBy: { createdAt: "asc" },
      take: SCAN_MESSAGE_LIMIT,
      select: { sender: true, body: true },
    });

    const suggestion = extractContactFromMessages(messages, {
      excludePhone: customer.phone,
    });

    // A regular who texts from a new number also lands here, and saving would
    // quietly leave the shop with two records for one person. Surfacing the
    // match lets staff open the existing profile instead.
    const possibleDuplicate = suggestion.email
      ? await prisma.customer.findFirst({
          where: {
            shopId: shop.id,
            id: { not: customer.id },
            provisional: false,
            email: { equals: suggestion.email, mode: "insensitive" },
          },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : null;

    return NextResponse.json({ customer, suggestion, possibleDuplicate });
  } catch (error) {
    console.error("GET /api/conversations/[id]/contact error:", error);
    return NextResponse.json(
      { error: "Failed to load contact details" },
      { status: 500 }
    );
  }
}

/**
 * Fills in the contact behind the thread and clears its provisional flag, so it
 * stops showing as an unidentified number in the inbox.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;
    const data = saveSchema.parse(await request.json());

    const conversation = await resolveStaffConversation(shop.id, id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const existing = await prisma.customer.findFirst({
      where: { id: conversation.customerId, shopId: shop.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // The stored number is what SMS replies are sent to, so a blank phone field
    // leaves it alone rather than clearing the only route back to the customer.
    const phone = data.phone ? coerceCustomerPhone(data.phone) : null;

    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        ...(phone ? { phone } : {}),
        address: data.address,
        notes: data.notes,
        provisional: false,
      },
      select: customerSelect,
    });

    return NextResponse.json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = Object.entries(error.flatten().fieldErrors ?? {})
        .flatMap(([field, fieldMessages]) =>
          (Array.isArray(fieldMessages) ? fieldMessages : [fieldMessages])
            .filter(Boolean)
            .map((message) => `${field}: ${message}`)
        )
        .join("; ");
      return NextResponse.json(
        { error: messages || "Invalid contact details" },
        { status: 400 }
      );
    }
    console.error("POST /api/conversations/[id]/contact error:", error);
    return NextResponse.json(
      { error: "Failed to save contact" },
      { status: 500 }
    );
  }
}
