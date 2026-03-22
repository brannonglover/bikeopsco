"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/calendar", label: "Job Board" },
  { href: "/stats", label: "Stats" },
  { href: "/settings/customers", label: "Customers" },
  { href: "/settings/services", label: "Services" },
  { href: "/settings/products", label: "Products" },
  { href: "/settings/email-templates", label: "Email Templates" },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 p-4 flex flex-col gap-1">
      {NAV_LINKS.map(({ href, label }) => {
        const isActive =
          href === "/calendar"
            ? pathname === "/calendar"
            : href === "/stats"
              ? pathname === "/stats"
              : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2.5 rounded-lg font-medium transition-colors text-base ${
              isActive
                ? "text-white bg-slate-600"
                : "text-slate-200 hover:text-white hover:bg-slate-600/50"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
