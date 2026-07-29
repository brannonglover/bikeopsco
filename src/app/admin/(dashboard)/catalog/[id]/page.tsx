import { AdminLogoutButton } from "../../AdminLogoutButton";
import { AdminNav } from "../../AdminNav";
import { AdminCatalogEditClient } from "../AdminCatalogEditClient";

export const dynamic = "force-dynamic";

export default function PlatformAdminCatalogBikePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Bike Ops</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Edit catalog bike</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Update identity fields and component slots. Year matching is strict — keep years accurate.
            </p>
            <AdminNav current="/admin/catalog" />
          </div>
          <AdminLogoutButton />
        </header>

        <AdminCatalogEditClient bikeId={params.id} />
      </div>
    </div>
  );
}
