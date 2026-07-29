import { AdminLogoutButton } from "../AdminLogoutButton";
import { AdminNav } from "../AdminNav";
import { AdminReleasesClient } from "./AdminReleasesClient";

export const dynamic = "force-dynamic";

export default function PlatformAdminReleasesPage() {
  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Bike Ops</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Release notes</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Review auto-generated drafts from production ships, edit the shop-facing bullets, then
              publish to{" "}
              <a
                href="https://bikeops.co/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 hover:underline"
              >
                bikeops.co/releases
              </a>
              .
            </p>
            <AdminNav current="/admin/releases" />
          </div>
          <AdminLogoutButton />
        </header>

        <AdminReleasesClient />
      </div>
    </div>
  );
}
