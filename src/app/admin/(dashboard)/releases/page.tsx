import { AdminReleasesClient } from "./AdminReleasesClient";

export const dynamic = "force-dynamic";

export default function PlatformAdminReleasesPage() {
  return (
    <>
      <header className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Release notes</h2>
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
      </header>

      <AdminReleasesClient />
    </>
  );
}
