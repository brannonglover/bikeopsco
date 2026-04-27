"use client";

import { type CSSProperties, useState } from "react";
import { YelpBurstIcon } from "@/components/icons/YelpBurstIcon";

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
        const color = filled || isHalf ? "#f59e0b" : "var(--w-star-empty)";
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

function PlatformBadge({ platform }: { platform: "google" | "yelp" }) {
  if (platform === "google") {
    return (
      <span className="w-platform-badge" aria-label="Google review">
        <svg width={12} height={12} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Google
      </span>
    );
  }
  return (
    <span className="w-platform-badge" aria-label="Yelp review">
      <YelpBurstIcon size={12} />
      Yelp
    </span>
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

const ACCENTS = [
  { base: "#14b8a6", wash: "rgba(20, 184, 166, 0.12)", deep: "#0f766e" },
  { base: "#f97316", wash: "rgba(249, 115, 22, 0.13)", deep: "#c2410c" },
  { base: "#3b82f6", wash: "rgba(59, 130, 246, 0.12)", deep: "#1d4ed8" },
  { base: "#e11d48", wash: "rgba(225, 29, 72, 0.11)", deep: "#be123c" },
  { base: "#84cc16", wash: "rgba(132, 204, 22, 0.14)", deep: "#4d7c0f" },
  { base: "#a855f7", wash: "rgba(168, 85, 247, 0.12)", deep: "#7e22ce" },
];

function accentFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ACCENTS[Math.abs(hash) % ACCENTS.length];
}

const TILES_PER_PAGE = 3;
const MAX_CHARS = 180;

const REVIEW_MOODS = [
  "Smooth ride",
  "Workshop win",
  "Fresh gears",
  "Back rolling",
  "Tune-up tale",
  "Happy miles",
];

export function ReviewCarousel({ reviews }: { reviews: ReviewEntry[] }) {
  const [page, setPage] = useState(0);

  if (reviews.length === 0) return null;

  const totalPages = Math.ceil(reviews.length / TILES_PER_PAGE);
  const start = page * TILES_PER_PAGE;
  const visible = reviews.slice(start, start + TILES_PER_PAGE);

  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const chevronStyle = (enabled: boolean): CSSProperties => ({
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.3,
  });

  return (
    <div className="w-carousel-shell">
      <div className="w-carousel-header">
        <div>
          <p className="w-kicker">Customer notes</p>
          <p className="w-carousel-title">Stories from the stand</p>
        </div>
        <div className="w-carousel-controls">
          <button
            className="w-carousel-button"
            style={chevronStyle(canPrev)}
            onClick={() => canPrev && setPage((p) => p - 1)}
            aria-label="Previous reviews"
            disabled={!canPrev}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--w-chevron-icon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </button>
          <button
            className="w-carousel-button"
            style={chevronStyle(canNext)}
            onClick={() => canNext && setPage((p) => p + 1)}
            aria-label="Next reviews"
            disabled={!canNext}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--w-chevron-icon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="w-tiles">
        {visible.map((review, i) => {
          const accent = accentFor(review.author);
          const truncated = review.text.length > MAX_CHARS
            ? review.text.slice(0, MAX_CHARS - 1).trimEnd() + "..."
            : review.text;
          const mood = REVIEW_MOODS[(start + i) % REVIEW_MOODS.length];
          const style = {
            "--w-accent": accent.base,
            "--w-accent-wash": accent.wash,
            "--w-accent-deep": accent.deep,
          } as CSSProperties;

          return (
            <article
              key={start + i}
              className="w-tile"
              style={style}
            >
              <div className="w-quote-mark" aria-hidden="true">&ldquo;</div>
              <div className="w-review-topline">
                <span className="w-mood-pill">{mood}</span>
                <PlatformBadge platform={review.platform} />
              </div>

              {truncated ? (
                <p className="w-review-copy">
                  {truncated}
                </p>
              ) : null}

              <div className="w-review-footer">
                <div className="w-avatar">
                  {initials(review.author) || "?"}
                </div>
                <div className="w-review-person">
                  <p className="w-review-author">{review.author}</p>
                  <p className="w-review-meta">
                    {review.relativeTime || `${review.rating.toFixed(1)} star review`}
                  </p>
                </div>
                <div className="w-stars-wrap">
                  <StarsRow rating={review.rating} size={12} />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Dot indicators */}
      {totalPages > 1 && (
        <div className="w-carousel-dots">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`Go to page ${i + 1}`}
              className={i === page ? "w-dot w-dot-active" : "w-dot"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
