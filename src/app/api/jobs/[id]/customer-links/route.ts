import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { getCustomerBillUrl, getCustomerStatusUrl } from "@/lib/job-customer-access";

/** Staff-only signed URLs for customer status and payment pages. */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  const job = await prisma.job.findFirst({
    where: { id: params.id, shopId: auth.shop.id },
    select: { id: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { id: shopId, subdomain } = auth.shop;
  return NextResponse.json({
    billUrl: getCustomerBillUrl(job.id, shopId, subdomain),
    statusUrl: getCustomerStatusUrl(job.id, shopId, subdomain),
  });
}
