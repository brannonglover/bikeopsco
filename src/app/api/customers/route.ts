import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { coerceCustomerPhone } from "@/lib/phone";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { resolveStaffShopId } from "@/lib/api-auth";
import { buildStaffVerbalSmsConsentUpdate } from "@/lib/sms-consent";

const createCustomerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Staff attests the customer agreed verbally on a call (phone bookings). */
  smsConsent: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";

    const trimmed = q.trim();

    const customers = trimmed
      ? await prisma.$queryRaw`
          SELECT * FROM "Customer"
          WHERE "shopId" = ${shop.id}
            AND (
              ("firstName" || ' ' || COALESCE("lastName", '')) ILIKE ${'%' + trimmed + '%'}
              OR "email" ILIKE ${'%' + trimmed + '%'}
              OR "phone" LIKE ${'%' + trimmed + '%'}
            )
          ORDER BY "firstName" ASC, "lastName" ASC
        `
      : await prisma.customer.findMany({
          where: { shopId: shop.id },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        });

    return NextResponse.json(customers);
  } catch (error) {
    console.error("GET /api/customers error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customers" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const data = createCustomerSchema.parse(body);

    // Verbal consent is only a record if it names the staff member who took it.
    let consentFields = {};
    if (data.smsConsent) {
      const staff = await resolveStaffShopId(request);
      if (!staff || staff.shopId !== shop.id) {
        return NextResponse.json(
          { error: "Staff sign-in required to record verbal SMS consent" },
          { status: 401 }
        );
      }
      consentFields = buildStaffVerbalSmsConsentUpdate(staff.userId);
    }

    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        email: data.email ?? null,
        phone: coerceCustomerPhone(data.phone),
        address: data.address ?? null,
        notes: data.notes ?? null,
        ...consentFields,
      },
    });

    return NextResponse.json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/customers error:", error);
    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 }
    );
  }
}
