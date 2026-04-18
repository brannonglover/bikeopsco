"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStaffChatWaitingCount } from "@/contexts/StaffChatAttentionContext";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";

const NAV_LINKS = [
  { href: "/calendar", label: "Job Board" },
  { href: "/archive", label: "Archive" },
  { href: "/chat", label: "Chat" },
  { href: "/stats", label: "Stats" },
  { href: "/settings/customers", label: "Customers" },
  { href: "/settings/services", label: "Services" },
  { href: "/settings/products", label: "Products" },
  { href: "/settings/email-templates", label: "Email Templates" },
  { href: "/settings/reviews", label: "Reviews" },
  { href: "/settings/features", label: "Features" },
] as const;

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const chatWaitingCount = useStaffChatWaitingCount();
  const features = useAppFeatures();

  const visibleLinks = NAV_LINKS.filter((l) => {
    if (l.href === "/chat" && !features.chatEnabled) return false;
    if (l.href === "/settings/reviews" && !features.reviewsEnabled) return false;
    return true;
  });

  return (
    <nav className="flex-1 p-4 flex flex-col gap-1">
      {visibleLinks.map(({ href, label }) => {
        const isActive =
          href === "/calendar"
            ? pathname === "/calendar"
            : href === "/stats"
              ? pathname === "/stats"
              : href === "/archive"
                ? pathname === "/archive"
                : pathname.startsWith(href);
        const showChatBadge = href === "/chat" && chatWaitingCount > 0;
        const chatLabel =
          showChatBadge && chatWaitingCount === 1
            ? "Chat, 1 conversation waiting for your reply"
            : showChatBadge
              ? `Chat, ${chatWaitingCount} conversations waiting for your reply`
              : undefined;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-label={chatLabel}
            className={`px-3 py-3 rounded-lg font-medium transition-colors text-base touch-manipulation flex items-center justify-between gap-2 min-w-0 ${
              isActive
                ? "text-white bg-slate-600"
                : "text-slate-200 hover:text-white hover:bg-slate-600/50 active:bg-slate-600/70"
            }`}
          >
            <span className="truncate">{label}</span>
            {showChatBadge && (
              <span
                className="flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-slate-900 text-xs font-semibold tabular-nums"
                aria-hidden
              >
                {chatWaitingCount > 99 ? "99+" : chatWaitingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
