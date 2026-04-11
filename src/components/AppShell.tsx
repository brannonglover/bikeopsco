"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { SidebarNav } from "@/components/SidebarNav";
import { CustomerMobileNav } from "@/components/CustomerMobileNav";
import { StaffChatAttentionProvider } from "@/contexts/StaffChatAttentionContext";
import { initNotificationSound } from "@/lib/notificationSound";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const isWidgetPage = pathname?.startsWith("/widget");
  const isPublicCustomerPage =
    pathname === "/book" ||
    pathname?.startsWith("/pay/") ||
    pathname?.startsWith("/status/") ||
    pathname?.startsWith("/chat/c");
  const isStaffPage = !isLoginPage && !isWidgetPage && !isPublicCustomerPage;
  const { status } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (isStaffPage && status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname ?? "/")}`);
    }
  }, [isStaffPage, status, router, pathname]);

  useEffect(() => {
    initNotificationSound();
  }, []);

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

  if (isLoginPage || isWidgetPage) {
    return <>{children}</>;
  }

  if (isPublicCustomerPage) {
    const isChatPage = pathname?.startsWith("/chat/c");
    const isStatusOrChat = pathname?.startsWith("/status/") || pathname?.startsWith("/chat/c") || pathname?.startsWith("/pay/");
    return (
      <div className="min-h-screen flex flex-col w-full min-w-0">
        <header className="flex-shrink-0 py-2 px-3 sm:py-3 sm:px-4 flex items-center justify-between gap-2">
          <div className="w-10 flex-shrink-0 flex items-center justify-start">
            {isStatusOrChat && (
              <Suspense fallback={<div className="w-10" />}>
                <CustomerMobileNav />
              </Suspense>
            )}
          </div>
          <div className="flex-1 flex justify-center min-w-0">
            <Image src="/bbm-logo-wo.png" alt="Bike Ops" width={320} height={120} className="h-14 w-auto sm:h-16 md:h-24" priority />
          </div>
          <div className="w-10 flex-shrink-0 flex items-center justify-end">
            {pathname?.startsWith("/pay/") && status === "authenticated" && (
              <Link
                href="/calendar"
                className="p-2 -mr-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                aria-label="Close and return to Job Board"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Link>
            )}
          </div>
        </header>
        <main
          className={
            isChatPage
              ? "flex-1 flex flex-col min-h-0 w-full min-w-0"
              : "flex-1 flex items-center justify-center p-4 sm:p-6"
          }
        >
          {children}
        </main>
      </div>
    );
  }

  const isStaffChatPage = pathname === "/chat";
  return (
    <StaffChatAttentionProvider syncEnabled={!isStaffChatPage}>
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

      {/* Sidebar - fixed on desktop so it stays put when scrolling; overlay on mobile when open */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50
          w-64 md:w-56 min-h-screen
          border-r border-slate-600/40 bg-slate-700 shadow-soft flex flex-col
          transform transition-transform duration-200 ease-out
          md:transform-none
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
        <div className="flex-1" />
        <div className="p-2 border-t border-slate-600/50 flex items-center gap-1">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex-1 rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:text-white hover:bg-slate-600/50 transition-colors"
          >
            Sign out
          </button>
          <Link
            href="/settings/appearance"
            className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600/50 transition-colors"
            aria-label="Settings"
            onClick={() => setMobileMenuOpen(false)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </aside>

      {/* Main content - offset for mobile header; left margin on desktop for fixed sidebar */}
      <main className="flex-1 min-w-0 pt-[calc(5.5rem+env(safe-area-inset-top,0px))] md:pt-6 md:ml-56 p-4 sm:p-6">{children}</main>
    </div>
    </StaffChatAttentionProvider>
  );
}
