"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brush,
  CircleDot,
  MessageSquareText,
  SlidersHorizontal,
} from "lucide-react";

const SETTINGS_LINKS = [
  { href: "/settings/appearance", label: "Appearance", icon: Brush },
  { href: "/settings/branding", label: "Branding", icon: CircleDot },
  { href: "/settings/features", label: "Features", icon: SlidersHorizontal },
  { href: "/settings/infobip", label: "Infobip SMS", icon: MessageSquareText },
] as const;

export function SettingsSectionNav() {
  const pathname = usePathname();

  return (
    <aside className="w-full flex-shrink-0 lg:sticky lg:top-6 lg:w-56">
      <div className="rounded-xl border border-surface-border bg-surface p-2 shadow-sm dark:shadow-none">
        <div className="px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <p className="mt-0.5 text-xs text-text-secondary">Workspace setup</p>
        </div>
        <nav className="mt-1 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SETTINGS_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:min-w-0 ${
                  active
                    ? "bg-primary-500/15 text-primary-700 ring-1 ring-primary-500/20 dark:text-primary-300"
                    : "text-text-secondary hover:bg-subtle-bg hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
