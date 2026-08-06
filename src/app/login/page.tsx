import { Suspense } from "react";
import { headers } from "next/headers";
import { UnclaimedShopPage } from "@/components/UnclaimedShopPage";
import { getShopForHost } from "@/lib/shop";
import { DEFAULT_ROOT_DOMAIN, getSubdomainFromHost, isSharedAppHost } from "@/lib/tenant-domain";
import LoginForm from "./LoginForm";

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN;

export default async function LoginPage() {
  const host = headers().get("host");
  const requestSubdomain = getSubdomainFromHost(host, {
    rootDomain: ROOT_DOMAIN,
    defaultSubdomain: process.env.DEFAULT_SHOP_SUBDOMAIN ?? null,
  });

  if (requestSubdomain && !isSharedAppHost(host, { rootDomain: ROOT_DOMAIN })) {
    const shop = await getShopForHost(host);
    if (!shop) {
      return <UnclaimedShopPage subdomain={requestSubdomain} />;
    }
  }

  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-mesh">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
            <div className="mx-auto h-16 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200" />
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
