import type { NextRequest } from "next/server";
import {
  GET as widgetGetCustomerBikes,
  OPTIONS as widgetOptionsCustomerBikes,
} from "@/app/api/widget/customer-bikes/route";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return widgetOptionsCustomerBikes(request);
}

export async function GET(request: NextRequest) {
  return widgetGetCustomerBikes(request);
}

