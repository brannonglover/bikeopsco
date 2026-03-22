"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav } from "@/components/SidebarNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPaymentPage = pathname?.startsWith("/pay/");

  if (isPaymentPage) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="flex-shrink-0 p-6 border-b border-slate-200 bg-white flex justify-center">
          <Link href="/" className="inline-flex items-center text-slate-600 hover:text-slate-900">
            <Image src="/bbm-logo-wo.png" alt="BikeOps" width={320} height={120} className="h-24 w-auto md:h-32" priority />
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-1 min-w-0">
      <aside className="flex-shrink-0 w-56 min-h-screen border-r border-slate-600/40 bg-slate-700 shadow-soft flex flex-col">
        <div className="p-4 border-b border-slate-600/50 flex justify-center">
          <Link href="/" className="flex items-center justify-center text-white hover:opacity-90 transition-opacity">
            <Image
              src="/bbm-logo-wo.png"
              alt="BBM"
              width={240}
              height={80}
              className="h-20 w-auto"
            />
          </Link>
        </div>
        <SidebarNav />
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
