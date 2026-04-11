import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req });

  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protect staff routes. Public: login, pay, status, chat/c, api/auth, webhooks, jobs, chat, cron
     */
    "/((?!_next|favicon|login|pay|status|chat/c|book|widget|api/auth|api/webhooks|api/jobs/|api/chat|api/cron|api/widget|api/og-preview|api/push-tokens|api/review-requests/.+/redirect).*)",
  ],
};
