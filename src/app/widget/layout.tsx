import type { Viewport } from "next";

export const metadata = {
  title: "Review Widget",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
