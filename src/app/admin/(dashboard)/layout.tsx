import { redirect } from "next/navigation";
import { getPlatformAdminSessionFromCookies } from "@/lib/platform-admin-session-server";
import { isPlatformAdminConfigured } from "@/lib/platform-admin";

export default async function PlatformAdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isPlatformAdminConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mesh p-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-lg font-semibold text-slate-900">Admin not configured</h1>
          <p className="mt-2 text-sm text-slate-600">
            Set <code className="text-xs">PLATFORM_ADMIN_EMAIL</code> and{" "}
            <code className="text-xs">PLATFORM_ADMIN_PASSWORD</code> on this deployment.
          </p>
        </div>
      </div>
    );
  }

  const session = await getPlatformAdminSessionFromCookies();
  if (!session) {
    redirect("/admin/login");
  }

  return children;
}
