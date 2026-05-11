"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStaffChatWaitingCount } from "@/contexts/StaffChatAttentionContext";
import { useAppFeatures } from "@/contexts/AppFeaturesContext";

const NAV_LINKS = [
  { href: "/calendar", label: "Job Board" },
  { href: "/waitlist", label: "Waitlist" },
  { href: "/archive", label: "Archive" },
  { href: "/chat", label: "Chat" },
  { href: "/stats", label: "Stats" },
  { href: "/customers", label: "Customers" },
  { href: "/services", label: "Services" },
  { href: "/products", label: "Products" },
  { href: "/email-templates", label: "Email Templates" },
  { href: "/reviews", label: "Reviews" },
  { href: "/billing", label: "Billing" },
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
    if (l.href === "/reviews" && !features.reviewsEnabled) return false;
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
            className={`px-3 py-3 rounded-lg font-medium transition-colors text-base touch-manipulation flex items-center gap-2 min-w-0 ${
              isActive
                ? "text-white bg-slate-600 shadow-[inset_3px_0_0_#e49a32]"
                : "text-slate-200 hover:text-white hover:bg-slate-600/50 active:bg-slate-600/70"
            }`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{label}</span>
              {showChatBadge && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.65)] ring-2 ring-white/35 animate-pulse"
                  aria-hidden
                />
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
