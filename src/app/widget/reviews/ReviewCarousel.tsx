"use client";

import { useState } from "react";

interface ReviewEntry {
  author: string;
  text: string;
  rating: number;
  platform: "google" | "yelp";
  relativeTime?: string | null;
}

function StarsRow({ rating, size = 13 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25 && rating - full < 0.75;
  return (
    <span style={{ display: "inline-flex", gap: "2px", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= full;
        const isHalf = half && i === full + 1;
        const color = filled || isHalf ? "#f59e0b" : "#e5e7eb";
        const opacity = isHalf ? 0.5 : 1;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20" fill={color} style={{ opacity }}>
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        );
      })}
    </span>
  );
}

function PlatformDot({ platform }: { platform: "google" | "yelp" }) {
  if (platform === "google") {
    return (
      <svg width={12} height={12} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    );
  }
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#d32323" d="M20.16 12.73l-4.703 1.01a.425.425 0 01-.43-.616l2.453-4.12a.425.425 0 01.72-.038 9.193 9.193 0 012.388 4.248.425.425 0 01-.428.516zm-8.56 5.852l-1.548 4.516a.425.425 0 01-.773.066A9.194 9.194 0 017.3 18.19a.425.425 0 01.434-.648l4.36.946a.425.425 0 01.507.484zm7.06-9.72a9.195 9.195 0 00-3.57-2.724.425.425 0 00-.572.42l.22 4.794a.425.425 0 00.698.305l3.35-2.07a.425.425 0 00-.126-.725zM6.522 6.21a9.194 9.194 0 00-2.338 4.156.425.425 0 00.546.502l4.578-1.608a.425.425 0 00.14-.724L6.522 6.21zm-.21 7.524l-4.64.79a.425.425 0 00-.282.64 9.2 9.2 0 002.743 3.107.425.425 0 00.626-.203l1.974-3.924a.425.425 0 00-.422-.41zM12 2.75a9.25 9.25 0 100 18.5A9.25 9.25 0 0012 2.75z" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#ef4444", "#14b8a6",
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const TILES_PER_PAGE = 2;

export function ReviewCarousel({ reviews }: { reviews: ReviewEntry[] }) {
  const [page, setPage] = useState(0);

  if (reviews.length === 0) return null;

  const totalPages = Math.ceil(reviews.length / TILES_PER_PAGE);
  const start = page * TILES_PER_PAGE;
  const visible = reviews.slice(start, start + TILES_PER_PAGE);

  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const chevronStyle = (enabled: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: enabled ? "#ffffff" : "#f9fafb",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.35,
    flexShrink: 0,
    padding: 0,
    outline: "none",
    transition: "background 0.15s, border-color 0.15s",
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "stretch", gap: "8px" }}>
        {/* Left chevron */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            style={chevronStyle(canPrev)}
            onClick={() => canPrev && setPage((p) => p - 1)}
            aria-label="Previous reviews"
            disabled={!canPrev}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </button>
        </div>

        {/* Tiles */}
        <div style={{ display: "flex", flex: 1, gap: "8px", overflow: "hidden" }}>
          {visible.map((review, i) => {
            const bg = avatarColor(review.author);
            const truncated = review.text.length > 90
              ? review.text.slice(0, 88).trimEnd() + "…"
              : review.text;
            return (
              <div
                key={start + i}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "#f9fafb",
                  border: "1px solid #f0f0f0",
                  borderRadius: "12px",
                  padding: "12px 12px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {/* Avatar + name */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: bg,
                      color: "#ffffff",
                      fontSize: "11px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {initials(review.author) || "?"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#111827",
                        margin: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {review.author}
                    </p>
                    {review.relativeTime ? (
                      <p style={{ fontSize: "10px", color: "#9ca3af", margin: 0 }}>
                        {review.relativeTime}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Stars + platform */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <StarsRow rating={review.rating} size={12} />
                  <PlatformDot platform={review.platform} />
                </div>

                {/* Review text */}
                {truncated ? (
                  <p
                    style={{
                      fontSize: "11.5px",
                      color: "#4b5563",
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    &ldquo;{truncated}&rdquo;
                  </p>
                ) : null}
              </div>
            );
          })}

          {/* Filler tile if odd number on last page */}
          {visible.length < TILES_PER_PAGE && (
            <div style={{ flex: 1 }} />
          )}
        </div>

        {/* Right chevron */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            style={chevronStyle(canNext)}
            onClick={() => canNext && setPage((p) => p + 1)}
            aria-label="Next reviews"
            disabled={!canNext}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Dot indicators */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "5px", marginTop: "10px" }}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`Go to page ${i + 1}`}
              style={{
                width: i === page ? "16px" : "6px",
                height: "6px",
                borderRadius: "3px",
                background: i === page ? "#6366f1" : "#d1d5db",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "width 0.2s, background 0.2s",
                outline: "none",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
