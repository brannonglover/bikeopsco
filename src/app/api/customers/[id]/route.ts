import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMissedBookingConfirmationEmails } from "@/lib/email";
import { coerceCustomerPhone } from "@/lib/phone";
import { z } from "zod";
import { resolveStaffShopId } from "@/lib/api-auth";
import {
  buildSmsConsentUpdate,
  buildStaffVerbalSmsConsentUpdate,
  SMS_CONSENT_SOURCES,
} from "@/lib/sms-consent";

const updateCustomerSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Staff-recorded consent: true attests verbal agreement, false records an opt-out. */
  smsConsent: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json(customer);
  } catch (error) {
    console.error("GET /api/customers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = updateCustomerSchema.parse(body);

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Verbal consent is only a record if it names the staff member who took it.
    let consentFields = {};
    if (data.smsConsent !== undefined) {
      const staff = await resolveStaffShopId(request);
      if (!staff || staff.shopId !== existing.shopId) {
        return NextResponse.json(
          { error: "Staff sign-in required to record SMS consent" },
          { status: 401 }
        );
      }
      consentFields = data.smsConsent
        ? buildStaffVerbalSmsConsentUpdate(staff.userId)
        : buildSmsConsentUpdate(false, SMS_CONSENT_SOURCES.STAFF_OPT_OUT);
    }

    const previousEmail = existing.email?.trim() ?? "";
    const emailFirstAdded =
      data.email !== undefined && !previousEmail && !!(data.email?.trim());

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && {
          phone: coerceCustomerPhone(data.phone),
        }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...consentFields,
      },
    });

    if (emailFirstAdded) {
      void sendMissedBookingConfirmationEmails(customer).catch((e) =>
        console.error("[PATCH customer] Missed booking confirmation send failed:", e)
      );
    }

    return NextResponse.json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {})
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean).map((m) => `${field}: ${m}`)
        );
      return NextResponse.json(
        { error: fieldErrors.join("; ") },
        { status: 400 }
      );
    }
    console.error("PATCH /api/customers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.customer.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/customers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}
