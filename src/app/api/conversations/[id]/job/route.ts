import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  buildConversationContext,
  CONTEXT_CUSTOMER_SELECT,
} from "@/lib/conversation-context";
import {
  resolveStaffConversation,
  resolveStaffConversationForRead,
} from "@/lib/conversation";
import { createBookingJob } from "@/lib/create-booking-job";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const customerSelect = CONTEXT_CUSTOMER_SELECT;

/**
 * Everything the review screen shows, and nothing it decides.
 *
 * The screen is a confirmation step, not a form: the conversation has already
 * said what it is going to say, and staff are here to check it before it
 * becomes a job. So this hands over the context as-is — symptoms, suspicions
 * and requests still in their own lists — alongside what the shop sells and
 * what the customer already owns, and lets the screen do the mapping.
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

    const [services, customerBikes, existingJobs] = await Promise.all([
      // System services (the collection fee) are managed by the job itself and
      // hidden ones are off the menu, so neither is offered or matched against.
      prisma.service.findMany({
        where: { shopId: shop.id, isSystem: false, isHidden: false },
        select: { id: true, name: true, price: true },
        orderBy: { name: "asc" },
      }),
      // Bikes already on file. A customer who says "my commuter" gave us no
      // make, and picking the bike they already own beats retyping it.
      prisma.bike.findMany({
        where: { shopId: shop.id, customerId: customer.id },
        select: { id: true, make: true, model: true, bikeType: true },
        orderBy: { createdAt: "desc" },
      }),
      // Jobs already built from this thread. Staff see them before creating a
      // second one, because the same conversation reaching the board twice is
      // easy to do and annoying to undo.
      prisma.job.findMany({
        where: {
          shopId: shop.id,
          createdFromConversationId: conversation.id,
          archivedAt: null,
        },
        select: { id: true, stage: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const context = await buildConversationContext({
      conversationId: conversation.id,
      customer,
      services,
    });

    return NextResponse.json({
      customer,
      identity: context.identity,
      bikes: context.bikes,
      service: context.service,
      scheduling: context.scheduling,
      // Decimal does not survive JSON on its own terms; the screen only ever
      // displays this.
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        price: Number(service.price),
      })),
      customerBikes,
      existingJobs,
    });
  } catch (error) {
    console.error("GET /api/conversations/[id]/job error:", error);
    return NextResponse.json(
      { error: "Failed to read this conversation" },
      { status: 500 }
    );
  }
}

const bikeSchema = z.object({
  make: z.string().trim().min(1, "Bike make is required"),
  model: z.string().trim().optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).nullable().optional(),
});

const createSchema = z.object({
  bikes: z.array(bikeSchema).min(1, "Add at least one bike"),
  serviceIds: z.array(z.string()).default([]),
  customerNotes: z.string().trim().max(5000).optional().nullable(),
  /**
   * A real date, set by a person. The customer's "Friday around lunchtime"
   * reaches the job as a note; it is never parsed into this. Plain date string
   * as the booking form sends, rather than a full timestamp.
   */
  dropOffDate: z
    .string()
    .optional()
    .nullable()
    .refine(
      (value) => !value || !Number.isNaN(new Date(value).getTime()),
      "Enter a valid drop-off date"
    ),
});

/**
 * Creates the job staff just reviewed.
 *
 * Only what staff confirmed is written. The conversation context is not
 * re-read here on purpose: what the screen showed is what gets saved, so a
 * value they corrected cannot be overwritten by the extractor that suggested
 * it, and a message arriving mid-review cannot change the job underneath them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;
    const data = createSchema.parse(await request.json());

    const conversation = await resolveStaffConversation(shop.id, id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const customer = await prisma.customer.findFirst({
      where: { id: conversation.customerId, shopId: shop.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        address: true,
        provisional: true,
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // A provisional contact's name is the number they texted from, standing in
    // until someone fills it in. Building a job on that puts a phone number in
    // the customer column of the board and on every email the job sends, so
    // the contact has to be made real first — which is what "Create contact",
    // one button along, is for.
    if (customer.provisional) {
      return NextResponse.json(
        {
          error:
            "This contact is still just a phone number. Use Create contact first, then create the job.",
        },
        { status: 409 }
      );
    }

    const job = await prisma.$transaction((tx) =>
      createBookingJob(tx, {
        shopId: shop.id,
        // Passing the id is what keeps this off the email-matching path, which
        // matters because a chat contact often has no email at all and an empty
        // one would match the wrong person.
        customerId: customer.id,
        // The customer's own details, unchanged. Editing the contact is what
        // "Create contact" is for; creating a job must not quietly rewrite the
        // name, and passing the stored phone back keeps SMS replies working.
        firstName: customer.firstName,
        lastName: customer.lastName ?? "",
        email: customer.email ?? "",
        phone: customer.phone,
        address: customer.address,
        // Consent is not granted by staff on a customer's behalf. Passing false
        // leaves whatever the customer has already agreed to untouched.
        smsConsent: false,
        deliveryType: "DROP_OFF_AT_SHOP",
        dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
        pickupDate: null,
        customerNotes: data.customerNotes ?? null,
        serviceIds: data.serviceIds,
        bikes: data.bikes.map((bike) => ({
          make: bike.make,
          model: bike.model ?? null,
          bikeType: bike.bikeType ?? null,
        })),
        // Drop-off only from here, so no collection fee applies.
        collectionServiceEnabled: false,
        // Staff reviewed this on the way in; sending it to the approval queue
        // would only ask them to approve their own work.
        stage: "BOOKED_IN",
        createdFromConversationId: conversation.id,
      })
    );

    if (!job) {
      return NextResponse.json(
        { error: "The job was created but could not be read back" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: job.id, stage: job.stage });
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
        { error: messages || "Invalid job details" },
        { status: 400 }
      );
    }
    console.error("POST /api/conversations/[id]/job error:", error);
    return NextResponse.json(
      { error: "Failed to create this job" },
      { status: 500 }
    );
  }
}
