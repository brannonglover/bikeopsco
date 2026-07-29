import { AdminCatalogListClient } from "./AdminCatalogListClient";

export const dynamic = "force-dynamic";

export default function PlatformAdminCatalogPage() {
  return (
    <>
      <header className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Bike catalog</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Add and edit owned make/model/year component specs used by the Parts info tab on jobs.
          Do not import 99 Spokes or BikeBook data.
        </p>
      </header>

      <AdminCatalogListClient />
    </>
  );
}
