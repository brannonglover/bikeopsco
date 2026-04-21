import type { NextRequest } from "next/server";
import {
  GET as widgetGetCollectionEligibility,
  OPTIONS as widgetOptionsCollectionEligibility,
} from "@/app/api/widget/collection-eligibility/route";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return widgetOptionsCollectionEligibility(request);
}

export async function GET(request: NextRequest) {
  return widgetGetCollectionEligibility(request);
}

