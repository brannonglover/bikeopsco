import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { DEFAULT_ROOT_DOMAIN, getSubdomainFromHost, isSharedAppHost } from "@/lib/tenant-domain";
import { getPlatformAdminSession } from "@/lib/platform-admin-session";
import { isPlatformAdminHost } from "@/lib/platform-admin-host";

function buildTenantUrl(req: NextRequest, subdomain: string) {
  const url = req.nextUrl.clone();
  const rootDomain = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;

  if (url.hostname === "app.localhost" || url.hostname === "localhost") {
    url.hostname = `${subdomain}.localhost`;
  } else if (url.hostname === "app.lvh.me" || url.hostname.endsWith(".lvh.me")) {
    url.hostname = `${subdomain}.lvh.me`;
  } else {
    url.protocol = "https:";
    url.hostname = `${subdomain}.${rootDomain}`;
    url.port = "";
  }

  return url;
}

function isPublicPlatformAdminPath(pathname: string): boolean {
  return pathname === "/admin/login" || pathname === "/api/platform/auth/login";
}

function isPlatformAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/platform/");
}

export async function middleware(req: NextRequest) {
  const rootDomain = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;
  const pathname = req.nextUrl.pathname;

  if (isPlatformAdminPath(pathname)) {
    if (!isPlatformAdminHost(req.headers.get("host"))) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return new NextResponse("Not found", { status: 404 });
    }

    if (!isPublicPlatformAdminPath(pathname)) {
      const platformSession = await getPlatformAdminSession(req);
      if (!platformSession) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const loginUrl = new URL("/admin/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
      }
    }

    return NextResponse.next();
  }

  const token = await getToken({ req });
  const requestSubdomain = getSubdomainFromHost(req.headers.get("host"), {
    rootDomain,
    defaultSubdomain: process.env.DEFAULT_SHOP_SUBDOMAIN ?? null,
  });
  const sharedAppHost = isSharedAppHost(req.headers.get("host"), { rootDomain });

  if (sharedAppHost && token?.shopSubdomain) {
    return NextResponse.redirect(buildTenantUrl(req, token.shopSubdomain as string));
  }

  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (sharedAppHost) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Use your shop subdomain" }, { status: 400 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Prevent using a session from a different shop subdomain.
  if (
    requestSubdomain &&
    token.shopSubdomain &&
    token.shopSubdomain !== requestSubdomain
  ) {
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
     * Protect staff routes. Public: login, pay, status, chat/c, open, api/auth, webhooks, jobs, chat, cron
     */
    "/((?!_next|favicon|login|signup|pay|status|chat/c|open|book|widget|api/auth|api/signup|api/webhooks|api/jobs/|api/chat|api/cron|api/booking|api/widget|api/og-preview|api/push-tokens|api/review-requests/.+/redirect).*)",
  ],
};
