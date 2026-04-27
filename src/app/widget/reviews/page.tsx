import { prisma } from "@/lib/db";
import {
  fetchGooglePlaceData,
  fetchYelpBusinessData,
  extractYelpAlias,
  type ReviewEntry,
} from "@/lib/reviews";
import { getGooglePlacesApiKey, getYelpApiKey } from "@/lib/env";
import { ReviewCarousel } from "./ReviewCarousel";
import { AutoResize } from "./AutoResize";
import { getAppFeatures } from "@/lib/app-settings";
import { notFound } from "next/navigation";
import { YelpBurstIcon } from "@/components/icons/YelpBurstIcon";

export const dynamic = "force-dynamic";

// ─── Theme CSS variable sets ───────────────────────────────────────────────────

const LIGHT_VARS = `
  --w-card-bg: #ffffff;
  --w-card-border: #e5e7eb;
  --w-card-shadow: rgba(15, 23, 42, 0.08);
  --w-panel-bg: #f8fafc;
  --w-tile-bg: rgba(255, 255, 255, 0.88);
  --w-tile-border: rgba(15, 23, 42, 0.08);
  --w-text-heading: #111827;
  --w-text-body: #4b5563;
  --w-text-muted: #6b7280;
  --w-text-time: #9ca3af;
  --w-divider: #f3f4f6;
  --w-chevron-bg: #ffffff;
  --w-chevron-bg-off: #f9fafb;
  --w-chevron-border: #e5e7eb;
  --w-chevron-icon: #374151;
  --w-dot-active: #6366f1;
  --w-dot-inactive: #d1d5db;
  --w-star-empty: #e5e7eb;
  --w-badge-bg: rgba(255, 255, 255, 0.8);
  --w-quote: rgba(15, 23, 42, 0.07);
`;

const DARK_VARS = `
  --w-card-bg: #1e293b;
  --w-card-border: #334155;
  --w-card-shadow: rgba(0, 0, 0, 0.24);
  --w-panel-bg: #0f172a;
  --w-tile-bg: rgba(15, 23, 42, 0.86);
  --w-tile-border: rgba(148, 163, 184, 0.18);
  --w-text-heading: #f8fafc;
  --w-text-body: #cbd5e1;
  --w-text-muted: #94a3b8;
  --w-text-time: #64748b;
  --w-divider: #334155;
  --w-chevron-bg: #1e293b;
  --w-chevron-bg-off: #0f172a;
  --w-chevron-border: #334155;
  --w-chevron-icon: #94a3b8;
  --w-dot-active: #818cf8;
  --w-dot-inactive: #475569;
  --w-star-empty: #475569;
  --w-badge-bg: rgba(15, 23, 42, 0.68);
  --w-quote: rgba(248, 250, 252, 0.08);
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StarsRow({ rating, size = 16 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25 && rating - full < 0.75;
  return (
    <span style={{ display: "inline-flex", gap: "2px", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const color =
          i <= full
            ? "#f59e0b"
            : half && i === full + 1
            ? "#f59e0b"
            : "var(--w-star-empty)";
        const opacity = half && i === full + 1 ? 0.5 : 1;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20" fill={color} style={{ opacity }}>
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        );
      })}
    </span>
  );
}

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function reviewTimestamp(review: ReviewEntry): number {
  if (!review.createdAt) return 0;
  const t = Date.parse(review.createdAt);
  return Number.isFinite(t) ? t : 0;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReviewWidget({
  searchParams,
}: {
  searchParams: { theme?: string | string[] };
}) {
  const features = await getAppFeatures();
  if (!features.reviewsEnabled) notFound();
  const settings = await prisma.reviewSettings.findUnique({ where: { id: "default" } });

  const googleApiKey = getGooglePlacesApiKey();
  const yelpApiKey = getYelpApiKey();

  const yelpAlias = settings?.yelpReviewUrl
    ? extractYelpAlias(settings.yelpReviewUrl)
    : null;

  const [googleData, yelpData] = await Promise.all([
    settings?.googlePlaceId && googleApiKey
      ? fetchGooglePlaceData(settings.googlePlaceId, googleApiKey)
      : null,
    yelpAlias && yelpApiKey
      ? fetchYelpBusinessData(yelpAlias, yelpApiKey)
      : null,
  ]);

  const featuredReviews = (
    Array.isArray(settings?.featuredReviews) ? settings.featuredReviews : []
  ) as unknown as ReviewEntry[];

  // Merge live reviews and show the latest 15 (by timestamp when available).
  const mergedLive: ReviewEntry[] = [
    ...(googleData?.reviews ?? []),
    ...(yelpData?.reviews ?? []),
  ];
  const liveReviews = mergedLive
    .slice()
    .sort((a, b) => reviewTimestamp(b) - reviewTimestamp(a))
    .slice(0, 15);

  const displayReviews = (() => {
    if (liveReviews.length === 0) return featuredReviews.slice(0, 15);
    if (liveReviews.length >= 15) return liveReviews.slice(0, 15);

    const seen = new Set(
      liveReviews.map((r) => `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim())
    );
    const filler = featuredReviews.filter((r) => {
      const k = `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [...liveReviews, ...filler].slice(0, 15);
  })();

  const hasGoogle = !!(googleData || settings?.googleReviewUrl);
  const hasYelp = !!(yelpData || settings?.yelpReviewUrl);
  const showReviewInvite = displayReviews.length === 0 && !!(settings?.googleReviewUrl || settings?.yelpReviewUrl);

  // Resolve theme: "light" | "dark" | "auto" (default: "light")
  const rawTheme = Array.isArray(searchParams?.theme)
    ? searchParams.theme[0]
    : searchParams?.theme;
  const theme = rawTheme === "dark" || rawTheme === "auto" ? rawTheme : "light";

  const themeStyle =
    theme === "auto"
      ? `:root { ${LIGHT_VARS} } @media (prefers-color-scheme: dark) { :root { ${DARK_VARS} } }`
      : theme === "dark"
      ? `:root { ${DARK_VARS} }`
      : `:root { ${LIGHT_VARS} }`;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; background: transparent !important; }
        body { background: transparent !important; min-height: auto !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
        a { color: inherit; }
        ${themeStyle}

        .w-carousel-shell {
          border-radius: 16px;
          padding: 2px 0 0;
          background: transparent;
          border: 0;
          overflow: hidden;
        }

        .w-empty-review-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border-radius: 16px;
          padding: 8px 0 4px;
          background: transparent;
          border: 0;
          text-align: center;
        }

        .w-empty-title {
          color: var(--w-text-heading);
          font-size: 18px;
          line-height: 1.15;
          font-weight: 850;
          margin: 0;
        }

        .w-empty-copy {
          color: var(--w-text-muted);
          font-size: 12px;
          line-height: 1.45;
          margin: 6px auto 0;
          max-width: 330px;
        }

        .w-empty-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .w-review-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          border-radius: 999px;
          padding: 0 12px;
          background: transparent;
          border: 1px solid var(--w-tile-border);
          color: var(--w-text-heading);
          font-size: 12px;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
          transition: transform 0.15s, border-color 0.15s;
        }

        .w-review-action:hover {
          transform: translateY(-1px);
          border-color: var(--w-dot-active);
        }

        .w-platform-summary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .w-platform-summary-link {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 30px;
          border-radius: 999px;
          padding: 0 9px;
          color: var(--w-text-heading);
          text-decoration: none;
          background: transparent;
          border: 1px solid transparent;
          transition: border-color 0.15s, background 0.15s;
        }

        .w-platform-summary-link:hover {
          background: var(--w-badge-bg);
          border-color: var(--w-tile-border);
        }

        .w-platform-summary-copy {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
          white-space: nowrap;
        }

        .w-platform-summary-name {
          color: var(--w-text-heading);
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
        }

        .w-platform-summary-meta {
          color: var(--w-text-muted);
          font-size: 11px;
          font-weight: 650;
          line-height: 1;
        }

        .w-carousel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .w-carousel-title {
          color: var(--w-text-heading);
          font-size: 16px;
          line-height: 1.15;
          font-weight: 800;
          margin: 0;
        }

        .w-carousel-controls {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .w-carousel-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          border: 1px solid var(--w-chevron-border);
          background: var(--w-chevron-bg);
          padding: 0;
          outline: none;
          transition: transform 0.15s, background 0.15s, border-color 0.15s;
        }

        .w-carousel-button:not(:disabled):hover {
          transform: translateY(-1px);
          border-color: var(--w-dot-active);
        }

        .w-tiles {
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr;
          gap: 10px;
          align-items: stretch;
        }

        .w-tile {
          position: relative;
          min-width: 0;
          min-height: 178px;
          background:
            linear-gradient(150deg, var(--w-accent-wash), transparent 44%),
            var(--w-tile-bg);
          border: 1px solid var(--w-tile-border);
          border-radius: 8px;
          padding: 13px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 12px;
          overflow: hidden;
          box-shadow: 0 8px 20px var(--w-card-shadow);
        }

        .w-tile::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: var(--w-accent);
        }

        .w-tile:first-child {
          min-height: 194px;
        }

        .w-quote-mark {
          position: absolute;
          top: -18px;
          right: 10px;
          color: var(--w-quote);
          font-size: 88px;
          line-height: 1;
          font-family: Georgia, serif;
          pointer-events: none;
        }

        .w-review-topline,
        .w-review-footer {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .w-review-topline {
          justify-content: space-between;
        }

        .w-mood-pill,
        .w-platform-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          border-radius: 999px;
          white-space: nowrap;
          font-size: 10.5px;
          line-height: 1;
          font-weight: 800;
        }

        .w-mood-pill {
          color: var(--w-accent-deep);
          background: var(--w-accent-wash);
          padding: 6px 8px;
        }

        .w-platform-badge {
          color: var(--w-text-muted);
          background: var(--w-badge-bg);
          border: 1px solid var(--w-tile-border);
          padding: 6px 7px;
        }

        .w-review-copy {
          position: relative;
          color: var(--w-text-heading);
          font-size: 13px;
          line-height: 1.48;
          font-weight: 650;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 5;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .w-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          color: #ffffff;
          background: linear-gradient(135deg, var(--w-accent), var(--w-accent-deep));
          box-shadow: 0 7px 18px var(--w-accent-wash);
          font-size: 11px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .w-review-person {
          min-width: 0;
          flex: 1;
        }

        .w-review-author {
          color: var(--w-text-heading);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin: 0;
        }

        .w-review-meta {
          color: var(--w-text-time);
          font-size: 10.5px;
          line-height: 1.3;
          margin: 1px 0 0;
        }

        .w-stars-wrap {
          display: inline-flex;
          flex-shrink: 0;
        }

        .w-carousel-dots {
          display: flex;
          justify-content: center;
          gap: 5px;
          margin-top: 11px;
        }

        .w-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--w-dot-inactive);
          border: none;
          padding: 0;
          cursor: pointer;
          transition: width 0.2s, background 0.2s;
          outline: none;
        }

        .w-dot-active {
          width: 18px;
          background: var(--w-dot-active);
        }

        @media (max-width: 680px) {
          .w-tiles { grid-template-columns: 1fr; }
          .w-tile,
          .w-tile:first-child { min-height: 0; }
          .w-review-copy { -webkit-line-clamp: 4; }
          .w-stars-wrap { display: none; }
        }

        @media (max-width: 380px) {
          .w-carousel-header { align-items: flex-start; }
          .w-carousel-title { font-size: 15px; }
          .w-platform-badge { font-size: 0; gap: 0; }
          .w-platform-badge svg { margin: 0; }
        }
      `}</style>

      <AutoResize />

      <div style={{ padding: "10px" }}>
        <div
          style={{
            background: "transparent",
            borderRadius: "0",
            padding: "0",
            border: "0",
            boxShadow: "none",
          }}
        >
          {/* ── Rating summary row ── */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginBottom: displayReviews.length > 0 ? "10px" : "0" }}>
            {showReviewInvite ? (
              <div className="w-empty-review-panel">
                <div>
                  <p className="w-empty-title">Fresh stories coming soon</p>
                  <p className="w-empty-copy">
                    Loved the tune-up? Drop a quick note for the next rider choosing a workshop.
                  </p>
                </div>
                <div className="w-empty-actions">
                  {settings?.googleReviewUrl && (
                    <a
                      href={settings.googleReviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-review-action"
                    >
                      <GoogleIcon size={15} />
                      Google
                    </a>
                  )}
                  {settings?.yelpReviewUrl && (
                    <a
                      href={settings.yelpReviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-review-action"
                    >
                      <YelpBurstIcon size={15} />
                      Yelp
                    </a>
                  )}
                </div>
              </div>
            ) : hasGoogle || hasYelp ? (
              <div className="w-platform-summary">
                {hasGoogle && settings?.googleReviewUrl ? (
                  <a
                    href={settings.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-platform-summary-link"
                    aria-label={googleData ? `Google rating ${googleData.rating.toFixed(1)} from ${googleData.reviewCount} reviews` : "Review us on Google"}
                  >
                    <GoogleIcon size={16} />
                    <span className="w-platform-summary-copy">
                      <span className="w-platform-summary-name">Google</span>
                      <span className="w-platform-summary-meta">
                        {googleData
                          ? `${googleData.rating.toFixed(1)} · ${googleData.reviewCount.toLocaleString()} review${googleData.reviewCount !== 1 ? "s" : ""}`
                          : "Review"}
                      </span>
                    </span>
                  </a>
                ) : hasGoogle ? (
                  <span
                    className="w-platform-summary-link"
                    aria-label={googleData ? `Google rating ${googleData.rating.toFixed(1)} from ${googleData.reviewCount} reviews` : "Google reviews"}
                  >
                    <GoogleIcon size={16} />
                    <span className="w-platform-summary-copy">
                      <span className="w-platform-summary-name">Google</span>
                      <span className="w-platform-summary-meta">
                        {googleData
                          ? `${googleData.rating.toFixed(1)} · ${googleData.reviewCount.toLocaleString()} review${googleData.reviewCount !== 1 ? "s" : ""}`
                          : "Reviews"}
                      </span>
                    </span>
                  </span>
                ) : null}
                {hasYelp && settings?.yelpReviewUrl ? (
                  <a
                    href={settings.yelpReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-platform-summary-link"
                    aria-label={yelpData ? `Yelp rating ${yelpData.rating.toFixed(1)} from ${yelpData.reviewCount} reviews` : "Review us on Yelp"}
                  >
                    <YelpBurstIcon size={16} />
                    <span className="w-platform-summary-copy">
                      <span className="w-platform-summary-name">Yelp</span>
                      <span className="w-platform-summary-meta">
                        {yelpData
                          ? `${yelpData.rating.toFixed(1)} · ${yelpData.reviewCount.toLocaleString()} review${yelpData.reviewCount !== 1 ? "s" : ""}`
                          : "Review"}
                      </span>
                    </span>
                  </a>
                ) : hasYelp ? (
                  <span
                    className="w-platform-summary-link"
                    aria-label={yelpData ? `Yelp rating ${yelpData.rating.toFixed(1)} from ${yelpData.reviewCount} reviews` : "Yelp reviews"}
                  >
                    <YelpBurstIcon size={16} />
                    <span className="w-platform-summary-copy">
                      <span className="w-platform-summary-name">Yelp</span>
                      <span className="w-platform-summary-meta">
                        {yelpData
                          ? `${yelpData.rating.toFixed(1)} · ${yelpData.reviewCount.toLocaleString()} review${yelpData.reviewCount !== 1 ? "s" : ""}`
                          : "Reviews"}
                      </span>
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}

            {!showReviewInvite && !hasGoogle && !hasYelp && (
              <>
                <StarsRow rating={5} size={20} />
                <p style={{ fontSize: "14px", color: "var(--w-text-muted)" }}>Configure review links in settings.</p>
              </>
            )}
          </div>

          {/* ── Review carousel ── */}
          {displayReviews.length > 0 && (
            <ReviewCarousel reviews={displayReviews} />
          )}

        </div>
      </div>
    </>
  );
}
