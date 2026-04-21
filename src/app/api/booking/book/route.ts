import type { NextRequest } from "next/server";
import { OPTIONS as widgetOptionsBook, POST as widgetPostBook } from "@/app/api/widget/book/route";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return widgetOptionsBook(request);
}

export async function POST(request: NextRequest) {
  return widgetPostBook(request);
}

