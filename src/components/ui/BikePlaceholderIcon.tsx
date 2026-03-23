import { Bike } from "lucide-react";

/**
 * Bike outline icon used as placeholder when a bike image is not available.
 */
export function BikePlaceholderIcon({ className = "w-6 h-6 text-slate-400" }: { className?: string }) {
  return <Bike className={className} strokeWidth={2} aria-hidden />;
}
