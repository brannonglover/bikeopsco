import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMissedBookingConfirmationEmails } from "@/lib/email";
import { coerceCustomerPhone } from "@/lib/phone";
import { z } from "zod";
import { requireStaffShop, resolveStaffShopId } from "@/lib/api-auth";
import { RepairHistoryConflictError } from "@/lib/job-bike-replacement";
import {
  assertNoRepairHistory,
  logRepairHistoryDeletion,
  readRepairHistoryOverride,
} from "@/lib/bike-installed-components";
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const customer = await prisma.customer.findFirst({ where: { id, shopId: auth.shopId } });
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
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const data = updateCustomerSchema.parse(body);

    const existing = await prisma.customer.findFirst({ where: { id, shopId: auth.shopId } });
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const existing = await prisma.customer.findFirst({ where: { id, shopId: auth.shopId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Deleting a customer deletes their bikes and the repair history recorded
    // on them. Refuse unless the caller deliberately confirms (e.g. a privacy
    // request). Their jobs are kept either way.
    const override = readRepairHistoryOverride(request.nextUrl.searchParams);
    if ("error" in override) {
      return NextResponse.json({ error: override.error }, { status: 400 });
    }
    const erased = await prisma.$transaction(async (tx) => {
      if (!override.confirmed) {
        await assertNoRepairHistory(
          tx,
          { bike: { customerId: id } },
          "This customer’s bikes have repair history (parts fitted on completed jobs). Deleting the customer would erase it, so they weren’t deleted."
        );
      }
      const count = await tx.bikeInstalledComponent.count({ where: { bike: { customerId: id } } });
      await tx.customer.delete({ where: { id } });
      return count;
    });
    if (override.confirmed && erased > 0) {
      logRepairHistoryDeletion({
        shopId: auth.shopId,
        userId: auth.userId,
        entity: "customer",
        entityId: id,
        recordCount: erased,
        reason: override.reason,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RepairHistoryConflictError) {
      return NextResponse.json(
        { error: error.message, code: "repair_history", recordCount: error.recordCount },
        { status: 409 }
      );
    }
    console.error("DELETE /api/customers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}
