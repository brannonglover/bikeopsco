interface PriceProps {
  amount: number;
  /** "default" = pill badge, "inline" = plain text, "total" = emphasized for totals */
  variant?: "default" | "inline" | "total";
  className?: string;
}

export function Price({ amount, variant = "default", className = "" }: PriceProps) {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (variant === "inline") {
    return (
      <span className={`font-medium tabular-nums text-emerald-700 ${className}`}>
        ${formatted}
      </span>
    );
  }

  if (variant === "total") {
    return (
      <span
        className={`font-bold tabular-nums text-emerald-700 text-lg ${className}`}
      >
        ${formatted}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-semibold tabular-nums text-sm ${className}`}
    >
      ${formatted}
    </span>
  );
}
