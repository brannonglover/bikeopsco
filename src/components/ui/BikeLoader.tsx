/**
 * Playful loading indicator: spoked wheels spin and the bike rides along a
 * scrolling dirt trail (wavy terrain, rocks, grass tufts).
 *
 * Trail scroll uses <animateTransform> so the speed is in SVG user units and
 * stays perfectly in sync with the wheel spin (circumference 2π·10 ≈ 62.8u,
 * one revolution in 0.55 s → ~114 u/s → 44u tile passes in ~0.385 s).
 */
export function BikeLoader({ label = "Loading" }: { label?: string }) {
  // Each tile is 44 SVG units wide. We cover tiles at –88, –44, 0, 44, 88.
  // Within each tile, at these x offsets: grass@5, rock@14, rock@27, grass@36, rock@40.
  const tileOffsets = [-88, -44, 0, 44, 88];

  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      {/* Extra bottom padding so the trail area below the SVG box is not clipped */}
      <div className="animate-bike-ride overflow-visible px-4 pt-3 pb-7">
        <svg
          viewBox="-10 -8 108 72"
          className="h-16 w-[6.75rem] overflow-visible text-amber-500"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* ── Ground fill ───────────────────────────────────────────── */}
          <rect x="-10" y="46" width="108" height="20" fill="#92400e" stroke="none" opacity="0.09" />

          {/* ── Scrolling trail details ───────────────────────────────── */}
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0;-44,0"
              dur="0.385s"
              repeatCount="indefinite"
            />

            {/* Wavy terrain surface — 5 seamlessly-tiling 44u segments */}
            <path
              d={[
                "M-88,46 C-80,47 -74,47 -66,46 C-58,45 -52,45 -44,46",
                "C-36,47 -30,47 -22,46 C-14,45  -8,45   0,46",
                "C   8,47  14,47  22,46 C  30,45  36,45  44,46",
                "C  52,47  58,47  66,46 C  74,45  80,45  88,46",
                "C  96,47 102,47 110,46 C 118,45 124,45 132,46",
              ].join(" ")}
              stroke="#78350f"
              strokeWidth="0.8"
              fill="none"
              opacity="0.45"
            />

            {/* Per-tile: grass tufts + rocks */}
            {tileOffsets.map((t) => (
              <g key={t}>
                {/* Grass tuft at offset 5 */}
                <line x1={t + 5} y1="46" x2={t + 4} y2="43" stroke="#4d7c0f" strokeWidth="0.9" opacity="0.7" />
                <line x1={t + 5} y1="46" x2={t + 6} y2="43" stroke="#4d7c0f" strokeWidth="0.9" opacity="0.7" />
                {/* Rock at offset 14 */}
                <ellipse cx={t + 14} cy="48.5" rx="1.6" ry="1.1" fill="#78350f" stroke="none" opacity="0.38" />
                {/* Rock at offset 27 */}
                <circle cx={t + 27} cy="49" r="1" fill="#78350f" stroke="none" opacity="0.3" />
                {/* Grass tuft at offset 36 */}
                <line x1={t + 36} y1="46" x2={t + 35} y2="43.5" stroke="#4d7c0f" strokeWidth="0.9" opacity="0.6" />
                <line x1={t + 36} y1="46" x2={t + 37} y2="43" stroke="#4d7c0f" strokeWidth="0.9" opacity="0.6" />
                {/* Rock at offset 40 */}
                <ellipse cx={t + 40} cy="49.5" rx="2.1" ry="1.2" fill="#78350f" stroke="none" opacity="0.22" />
              </g>
            ))}
          </g>

          {/* ── Rear wheel + spokes ───────────────────────────────────── */}
          <g transform="translate(20, 36)">
            <g className="[transform-box:fill-box] origin-center animate-[spin_0.55s_linear_infinite]">
              <circle r="10" strokeWidth="2.5" />
              <g strokeWidth="1.75" opacity={0.95}>
                <line x1="-7" y1="0" x2="7" y2="0" />
                <line x1="0" y1="-7" x2="0" y2="7" />
                <line x1="-5" y1="-5" x2="5" y2="5" />
                <line x1="5" y1="-5" x2="-5" y2="5" />
              </g>
              <circle r="2" fill="currentColor" stroke="none" />
            </g>
          </g>

          {/* ── Front wheel + spokes ──────────────────────────────────── */}
          <g transform="translate(68, 36)">
            <g className="[transform-box:fill-box] origin-center animate-[spin_0.55s_linear_infinite]">
              <circle r="10" strokeWidth="2.5" />
              <g strokeWidth="1.75" opacity={0.95}>
                <line x1="-7" y1="0" x2="7" y2="0" />
                <line x1="0" y1="-7" x2="0" y2="7" />
                <line x1="-5" y1="-5" x2="5" y2="5" />
                <line x1="5" y1="-5" x2="-5" y2="5" />
              </g>
              <circle r="2" fill="currentColor" stroke="none" />
            </g>
          </g>

          {/* ── Frame ─────────────────────────────────────────────────── */}
          <g strokeWidth="2.25" className="text-slate-700">
            <path d="M20 36 L38 14 L54 14 L68 36" />
            <path d="M38 14 L28 36" />
            <path d="M38 14 L46 26 L54 14" />
            <path d="M54 14 L62 22" strokeWidth="2" />
          </g>
        </svg>
      </div>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
