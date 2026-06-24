import Link from "next/link";
import { listPlatformShops } from "@/lib/platform-shops";
import { AdminDeleteShopButton } from "./AdminDeleteShopButton";
import { AdminLogoutButton } from "./AdminLogoutButton";

export const dynamic = "force-dynamic";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

type PlatformShop = Awaited<ReturnType<typeof listPlatformShops>>[number];

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function billingLabel(status: string, trialEndsAt: Date | null): string {
  if (status === "active") return "Subscribed";
  if (status === "trialing") {
    if (trialEndsAt && trialEndsAt.getTime() > Date.now()) {
      return `Trial (ends ${formatDate(trialEndsAt)})`;
    }
    return "Trial ended";
  }
  return status;
}

function usageSummary(shop: PlatformShop): string {
  return `${shop.userCount} users · ${shop.customerCount} customers · ${shop.jobCount} jobs`;
}

function ShopLink({ subdomain }: { subdomain: string }) {
  return (
    <a
      href={`https://${subdomain}.${ROOT_DOMAIN}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-slate-600 hover:text-slate-900 hover:underline"
    >
      {subdomain}.{ROOT_DOMAIN}
    </a>
  );
}

function OwnerDetails({ shop }: { shop: PlatformShop }) {
  if (!shop.ownerName && !shop.ownerEmail) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <>
      {shop.ownerName && <p className="text-slate-900">{shop.ownerName}</p>}
      {shop.ownerEmail ? (
        <a
          href={`mailto:${shop.ownerEmail}`}
          title={shop.ownerEmail}
          className="block truncate text-slate-600 hover:text-slate-900 hover:underline"
        >
          {shop.ownerEmail}
        </a>
      ) : null}
    </>
  );
}

function ShopCard({ shop }: { shop: PlatformShop }) {
  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{shop.name}</p>
          <p className="mt-0.5 text-sm">
            <ShopLink subdomain={shop.subdomain} />
          </p>
        </div>
        <div className="shrink-0">
          <AdminDeleteShopButton shopId={shop.id} shopName={shop.name} />
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</dt>
          <dd className="mt-0.5">
            <OwnerDetails shop={shop} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed up</dt>
            <dd className="mt-0.5 text-slate-700">{formatDate(shop.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Billing</dt>
            <dd className="mt-0.5 text-slate-700">{billingLabel(shop.billingStatus, shop.trialEndsAt)}</dd>
          </div>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Usage</dt>
          <dd className="mt-0.5 text-slate-600">{usageSummary(shop)}</dd>
        </div>
      </dl>
    </article>
  );
}

export default async function PlatformAdminPage() {
  const shops = await listPlatformShops();

  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Bike Ops</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Trial signups</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Shops that registered through{" "}
              <Link href="https://app.bikeops.co/signup" className="font-medium text-slate-900 hover:underline">
                app.bikeops.co/signup
              </Link>
              . Newest first.
            </p>
          </div>
          <AdminLogoutButton />
        </header>

        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          <span className="font-semibold text-slate-900">{shops.length}</span>{" "}
          {shops.length === 1 ? "shop" : "shops"} registered
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {shops.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No shops have signed up yet.</p>
          ) : (
            <>
              <div className="divide-y divide-slate-100 md:hidden">
                {shops.map((shop) => (
                  <ShopCard key={shop.id} shop={shop} />
                ))}
              </div>

              <div className="hidden md:block">
                <table className="w-full table-fixed divide-y divide-slate-200 text-sm">
                  <colgroup>
                    <col className="w-[36%]" />
                    <col className="w-[28%]" />
                    <col className="w-[24%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-700">Shop</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-700">Owner</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-700">Status</th>
                      <th className="sticky right-0 z-20 bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-700 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.08)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shops.map((shop) => (
                      <tr key={shop.id} className="group hover:bg-slate-50/80">
                        <td className="min-w-0 px-3 py-2.5 align-top">
                          <p className="font-medium text-slate-900">{shop.name}</p>
                          <p className="mt-0.5">
                            <ShopLink subdomain={shop.subdomain} />
                          </p>
                          <p className="mt-1 text-xs leading-snug text-slate-500">{usageSummary(shop)}</p>
                        </td>
                        <td className="min-w-0 px-3 py-2.5 align-top">
                          <OwnerDetails shop={shop} />
                        </td>
                        <td className="px-3 py-2.5 align-top text-slate-700">
                          <p>{formatDate(shop.createdAt)}</p>
                          <p className="mt-1 text-xs leading-snug text-slate-600">
                            {billingLabel(shop.billingStatus, shop.trialEndsAt)}
                          </p>
                        </td>
                        <td className="sticky right-0 z-10 bg-white px-3 py-2.5 align-top shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.08)] group-hover:bg-slate-50/80">
                          <AdminDeleteShopButton shopId={shop.id} shopName={shop.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
