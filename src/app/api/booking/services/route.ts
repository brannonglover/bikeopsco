import type { NextRequest } from "next/server";
import {
  GET as widgetGetServices,
  OPTIONS as widgetOptionsServices,
} from "@/app/api/widget/services/route";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return widgetOptionsServices(request);
}

export async function GET(request: NextRequest) {
  return widgetGetServices(request);
}

