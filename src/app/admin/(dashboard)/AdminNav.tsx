import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Trial signups" },
  { href: "/admin/catalog", label: "Bike catalog" },
  { href: "/admin/releases", label: "Releases" },
] as const;

export function AdminNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className="mt-3 flex flex-wrap gap-3 text-sm">
      {LINKS.map((link) =>
        link.href === current ? (
          <span key={link.href} className="text-slate-400" aria-current="page">
            {link.label}
          </span>
        ) : (
          <Link key={link.href} href={link.href} className="font-medium text-slate-700 hover:underline">
            {link.label}
          </Link>
        )
      )}
    </nav>
  );
}
