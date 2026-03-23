"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { SidebarNav } from "@/components/SidebarNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicCustomerPage =
    pathname?.startsWith("/pay/") || pathname?.startsWith("/status/");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change (e.g. after clicking a link)
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile overlay is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  if (isPublicCustomerPage) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="flex-shrink-0 py-5 px-4 sm:py-6 sm:px-6 border-b border-slate-200 bg-white flex justify-center">
          <Link href="/" className="inline-flex items-center text-slate-600 hover:text-slate-900">
            <Image src="/bbm-logo-wo.png" alt="Bike Ops" width={320} height={120} className="h-20 w-auto sm:h-24 md:h-32" priority />
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center p-4 sm:p-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-1 min-w-0">
      {/* Mobile header bar - safe area spacer then centered content bar */}
      <header className="md:hidden flex-shrink-0 fixed top-0 left-0 right-0 z-40 flex flex-col bg-slate-700 border-b border-slate-600/50">
        <div className="h-[env(safe-area-inset-top,0px)]" aria-hidden />
        <div className="min-h-[4rem] py-3 flex items-center justify-between px-4">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 -ml-2 rounded-lg text-white hover:bg-slate-600/50 transition-colors touch-manipulation"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/" className="flex items-center justify-center flex-1 min-w-0" onClick={() => setMobileMenuOpen(false)}>
            <Image src="/bbm-logo-wo.png" alt="BBM" width={160} height={53} className="h-12 w-auto" />
          </Link>
          <div className="w-10 flex-shrink-0" aria-hidden />
        </div>
      </header>

      {/* Mobile overlay when menu open */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile, overlay when open */}
      <aside
        className={`
          fixed md:relative inset-y-0 left-0 z-50
          w-64 md:w-56 min-h-screen
          border-r border-slate-600/40 bg-slate-700 shadow-soft flex flex-col
          transform transition-transform duration-200 ease-out
          md:transform-none md:flex-shrink-0
          pt-[env(safe-area-inset-top,0px)] md:pt-0
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="p-4 py-5 md:py-4 border-b border-slate-600/50 flex items-center justify-between md:justify-center">
          <Link
            href="/"
            className="flex items-center text-white hover:opacity-90 transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Image src="/bbm-logo-wo.png" alt="BBM" width={240} height={80} className="h-16 md:h-20 w-auto" />
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-2 -mr-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-600/50"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <SidebarNav onNavigate={() => setMobileMenuOpen(false)} />
      </aside>

      {/* Main content - offset for mobile header (safe area + bar) + extra top space for title; normal padding on desktop */}
      <main className="flex-1 min-w-0 pt-[calc(5.5rem+env(safe-area-inset-top,0px)+1.25rem)] md:pt-6 p-4 sm:p-6">{children}</main>
    </div>
  );
}
