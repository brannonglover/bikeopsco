import Link from "next/link";
import { listPlatformShops } from "@/lib/platform-shops";
import { AdminLogoutButton } from "./AdminLogoutButton";

export const dynamic = "force-dynamic";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Shop</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Owner</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Signed up</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Billing</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shops.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No shops have signed up yet.
                    </td>
                  </tr>
                ) : (
                  shops.map((shop) => (
                    <tr key={shop.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-slate-900">{shop.name}</p>
                        <a
                          href={`https://${shop.subdomain}.${ROOT_DOMAIN}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-600 hover:text-slate-900 hover:underline"
                        >
                          {shop.subdomain}.{ROOT_DOMAIN}
                        </a>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {shop.ownerName && <p className="text-slate-900">{shop.ownerName}</p>}
                        {shop.ownerEmail ? (
                          <a
                            href={`mailto:${shop.ownerEmail}`}
                            className="text-slate-600 hover:text-slate-900 hover:underline"
                          >
                            {shop.ownerEmail}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-700">
                        {formatDate(shop.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {billingLabel(shop.billingStatus, shop.trialEndsAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-600">
                        {shop.userCount} users · {shop.customerCount} customers · {shop.jobCount} jobs
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
