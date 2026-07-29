import { AdminCatalogEditClient } from "../AdminCatalogEditClient";

export const dynamic = "force-dynamic";

export default function PlatformAdminCatalogBikePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <>
      <header className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Edit catalog bike</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Update identity fields and component slots. Year matching is strict — keep years accurate.
        </p>
      </header>

      <AdminCatalogEditClient bikeId={params.id} />
    </>
  );
}
