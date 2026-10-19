import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { DEFAULT_ROOT_DOMAIN, classifyHost, parseDefaultShopHosts } from "@/lib/tenant-domain";

/** Mirrors DEFAULT_SHOP_ID in src/lib/shop.ts (which can't be imported here: it uses Prisma). */
const DEFAULT_SHOP_ID = "shop_default";

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

export async function middleware(req: NextRequest) {
  const rootDomain = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;
  const token = await getToken({ req });
  const host = classifyHost(req.headers.get("host"), {
    rootDomain,
    defaultSubdomain: process.env.DEFAULT_SHOP_SUBDOMAIN ?? null,
    defaultShopHosts: parseDefaultShopHosts(process.env.DEFAULT_SHOP_HOSTS),
  });
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const tokenSubdomain = typeof token?.shopSubdomain === "string" ? token.shopSubdomain : null;

  if (host.kind === "shared" && tokenSubdomain) {
    return NextResponse.redirect(buildTenantUrl(req, tokenSubdomain));
  }

  if (!token) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set(
      "callbackUrl",
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  if (host.kind === "shared") {
    if (isApi) {
      return NextResponse.json({ error: "Use your shop subdomain" }, { status: 400 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // A staff session only works on its own shop's host. An unknown host (apex,
  // www, another domain, a deployment URL) serves no shop, and a host that
  // serves the default shop accepts only the default shop's staff — the shop
  // is never taken from the host alone. Route handlers enforce the same rule
  // server-side (requireStaffShop), so this is the first line, not the only one.
  const sessionMatchesHost =
    host.kind === "tenant"
      ? tokenSubdomain === host.subdomain
      : host.kind === "default"
        ? token.shopId === DEFAULT_SHOP_ID
        : false;

  if (!sessionMatchesHost) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Send them to their own shop rather than a login loop.
    if (host.kind === "unknown" && tokenSubdomain) {
      return NextResponse.redirect(buildTenantUrl(req, tokenSubdomain));
    }
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set(
      "callbackUrl",
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protect staff routes. Public: login, signup, admin, platform APIs, pay, status, chat/c, open, api/auth, webhooks, jobs, chat, cron.
     * api/blob authorizes every read itself, by the file's owning shop (blob-access.ts).
     */
    "/((?!_next|favicon|bikeops-sw\\.js|login|signup|admin|api/platform|api/shops|api/releases|pay|status|chat/c|open|book|widget|api/auth|api/signup|api/billing/apple|api/webhooks|api/jobs/|api/chat|api/cron|api/booking|api/widget|api/og-preview|api/push-tokens|api/version|api/review-requests/.+/redirect|api/blob).*)",
  ],
};
