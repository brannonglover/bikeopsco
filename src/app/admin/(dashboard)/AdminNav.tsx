"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Trial signups" },
  { href: "/admin/catalog", label: "Bike catalog" },
  { href: "/admin/releases", label: "Releases" },
] as const;

function isActive(href: string, pathname: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin" || pathname === "/admin/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      aria-label="Admin sections"
      className="flex flex-wrap border-b border-slate-200"
    >
      {LINKS.map((link) => {
        const active = isActive(link.href, pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            role="tab"
            aria-selected={active}
            className={`px-4 py-3 text-sm font-medium transition-colors touch-manipulation ${
              active
                ? "border-b-2 border-blue-600 -mb-px text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
