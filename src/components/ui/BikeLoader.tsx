/**
 * Playful loading indicator for the booking widget: spoked wheels spin and the bike sways slightly.
 */
export function BikeLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="animate-bike-ride">
        <svg
          viewBox="0 0 88 52"
          className="h-14 w-[5.5rem] text-amber-500"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* Rear wheel + spokes */}
          <g transform="translate(20, 36)">
            <g className="origin-center animate-[spin_0.55s_linear_infinite]">
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
          {/* Front wheel + spokes */}
          <g transform="translate(68, 36)">
            <g className="origin-center animate-[spin_0.55s_linear_infinite]">
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
          {/* Frame — drawn above wheels */}
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
