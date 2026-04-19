import React from "react";

export function YelpBurstIcon({
  size = 18,
  className,
  title = "Yelp",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  /**
   * Yelp’s mark is a 5‑petal “burst”. We render a simple geometric burst
   * (5 rounded petals rotated around center) which matches the expected shape.
   */
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={title}
      style={{ flexShrink: 0 }}
    >
      <g transform="translate(12 12)" fill="#d32323">
        {Array.from({ length: 5 }).map((_, i) => (
          <g key={i} transform={`rotate(${i * 72})`}>
            <rect x={-1.6} y={-10.6} width={3.2} height={7.2} rx={1.6} />
          </g>
        ))}
      </g>
    </svg>
  );
}

