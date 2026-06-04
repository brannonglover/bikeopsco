import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  getCustomerIdForActiveJobAccess,
  getSessionCookieMaxAgeSeconds,
  getSessionCookieName,
} from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().min(1),
  access: z.string().min(1),
});

/**
 * Customer with an in-progress repair can open web chat via their job status link
 * (same trust model as /status/[jobId]) without a separate email sign-in.
 */
export async function POST(request: NextRequest) {
  try {
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }

    const { jobId, access } = schema.parse(await request.json());
    const customerId = await getCustomerIdForActiveJobAccess(shop.id, jobId, access);
    if (!customerId) {
      return NextResponse.json({ error: "invalid_job" }, { status: 404 });
    }

    const sessionToken = await createSession(customerId);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(getSessionCookieName(), sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getSessionCookieMaxAgeSeconds(),
      path: "/",
    });
    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_job" }, { status: 400 });
    }
    console.error("POST /api/chat/establish-job-access error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
