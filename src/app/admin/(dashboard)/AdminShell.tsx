import { AdminLogoutButton } from "./AdminLogoutButton";
import { AdminNav } from "./AdminNav";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Bike Ops</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Platform admin</h1>
          </div>
          <AdminLogoutButton />
        </header>

        <div className="mb-8">
          <AdminNav />
        </div>

        {children}
      </div>
    </div>
  );
}
