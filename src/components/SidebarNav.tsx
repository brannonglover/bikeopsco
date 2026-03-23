"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/calendar", label: "Job Board" },
  { href: "/archive", label: "Archive" },
  { href: "/chat", label: "Chat" },
  { href: "/stats", label: "Stats" },
  { href: "/settings/customers", label: "Customers" },
  { href: "/settings/services", label: "Services" },
  { href: "/settings/products", label: "Products" },
  { href: "/settings/email-templates", label: "Email Templates" },
] as const;

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 p-4 flex flex-col gap-1">
      {NAV_LINKS.map(({ href, label }) => {
        const isActive =
          href === "/calendar"
            ? pathname === "/calendar"
            : href === "/stats"
              ? pathname === "/stats"
              : href === "/archive"
                ? pathname === "/archive"
                : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`px-3 py-3 rounded-lg font-medium transition-colors text-base touch-manipulation ${
              isActive
                ? "text-white bg-slate-600"
                : "text-slate-200 hover:text-white hover:bg-slate-600/50 active:bg-slate-600/70"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
