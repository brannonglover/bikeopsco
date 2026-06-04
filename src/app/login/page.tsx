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
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-mesh">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
