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

export const dynamic = "force-dynamic";

// ─── Theme CSS variable sets ───────────────────────────────────────────────────

const LIGHT_VARS = `
  --w-card-bg: #ffffff;
  --w-card-border: #e5e7eb;
  --w-tile-bg: #f9fafb;
  --w-tile-border: #efefef;
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
`;

const DARK_VARS = `
  --w-card-bg: #1e293b;
  --w-card-border: #334155;
  --w-tile-bg: #0f172a;
  --w-tile-border: #1e293b;
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

function YelpIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }} aria-label="Yelp">
      {/* Simple Yelp-like burst mark (5 petals) */}
      <path
        fill="#d32323"
        d="M12 2.3c.9 0 1.7.6 1.9 1.5l.5 2.2c.1.4.4.7.8.8l2.2.5c.9.2 1.5 1 1.5 1.9 0 .3-.1.7-.3 1l-1.2 1.9c-.2.4-.2.8 0 1.1l1.2 1.9c.2.3.3.7.3 1 0 .9-.6 1.7-1.5 1.9l-2.2.5c-.4.1-.7.4-.8.8l-.5 2.2c-.2.9-1 1.5-1.9 1.5s-1.7-.6-1.9-1.5l-.5-2.2c-.1-.4-.4-.7-.8-.8l-2.2-.5c-.9-.2-1.5-1-1.5-1.9 0-.3.1-.7.3-1l1.2-1.9c.2-.4.2-.8 0-1.1L5.3 9.7C5.1 9.4 5 9 5 8.7c0-.9.6-1.7 1.5-1.9l2.2-.5c.4-.1.7-.4.8-.8l.5-2.2c.2-.9 1-1.5 1.9-1.5Z"
      />
      <circle cx="12" cy="12" r="3.2" fill="var(--w-card-bg)" opacity="0.95" />
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

  const displayReviews = liveReviews.length > 0 ? liveReviews : featuredReviews;

  const hasGoogle = !!(googleData || settings?.googleReviewUrl);
  const hasYelp = !!(yelpData || settings?.yelpReviewUrl);

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
        html { -webkit-text-size-adjust: 100%; }
        body { background: var(--w-card-bg) !important; min-height: auto !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
        a { color: inherit; }
        ${themeStyle}

        /* Responsive tile grid */
        .w-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 620px) { .w-tiles { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 340px) { .w-tiles { grid-template-columns: 1fr; } }

        /* Tile card */
        .w-tile {
          background: var(--w-tile-bg);
          border: 1px solid var(--w-tile-border);
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
      `}</style>

      <AutoResize />

      <div style={{ padding: "10px" }}>
        <div
          style={{
            background: "var(--w-card-bg)",
            borderRadius: "14px",
            padding: "18px 20px",
            border: "1px solid var(--w-card-border)",
          }}
        >
          {/* ── Rating summary row ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: displayReviews.length > 0 ? "16px" : "0" }}>
            {googleData ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <GoogleIcon size={20} />
                <StarsRow rating={googleData.rating} size={17} />
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--w-text-heading)" }}>
                  {googleData.rating.toFixed(1)}
                </span>
                <span style={{ fontSize: "13px", color: "var(--w-text-muted)" }}>
                  {googleData.reviewCount.toLocaleString()} review{googleData.reviewCount !== 1 ? "s" : ""}
                </span>
                {settings?.googleReviewUrl && (
                  <a
                    href={settings.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: "auto", fontSize: "12px", color: "#4285F4", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    Leave a review →
                  </a>
                )}
              </div>
            ) : hasGoogle && settings?.googleReviewUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <GoogleIcon size={20} />
                <StarsRow rating={5} size={17} />
                <a
                  href={settings.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "13px", color: "#4285F4", fontWeight: 600, textDecoration: "none" }}
                >
                  Review us on Google →
                </a>
              </div>
            ) : null}

            {yelpData ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <YelpIcon size={20} />
                <StarsRow rating={yelpData.rating} size={17} />
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--w-text-heading)" }}>
                  {yelpData.rating.toFixed(1)}
                </span>
                <span style={{ fontSize: "13px", color: "var(--w-text-muted)" }}>
                  {yelpData.reviewCount.toLocaleString()} review{yelpData.reviewCount !== 1 ? "s" : ""}
                </span>
                {settings?.yelpReviewUrl && (
                  <a
                    href={settings.yelpReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: "auto", fontSize: "12px", color: "#d32323", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    Leave a review →
                  </a>
                )}
              </div>
            ) : hasYelp && settings?.yelpReviewUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <YelpIcon size={20} />
                <StarsRow rating={5} size={17} />
                <a
                  href={settings.yelpReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "13px", color: "#d32323", fontWeight: 600, textDecoration: "none" }}
                >
                  Review us on Yelp →
                </a>
              </div>
            ) : null}

            {!hasGoogle && !hasYelp && (
              <>
                <StarsRow rating={5} size={20} />
                <p style={{ fontSize: "14px", color: "var(--w-text-muted)" }}>Configure review links in settings.</p>
              </>
            )}
          </div>

          {/* ── Divider ── */}
          {displayReviews.length > 0 && (
            <hr style={{ border: "none", borderTop: "1px solid var(--w-divider)", marginBottom: "14px" }} />
          )}

          {/* ── Review carousel ── */}
          {displayReviews.length > 0 && (
            <ReviewCarousel reviews={displayReviews} />
          )}

          {/* ── View all reviews footer ── */}
          {(settings?.googleReviewUrl || settings?.yelpReviewUrl) && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "16px",
                marginTop: "14px",
                paddingTop: "12px",
                borderTop: displayReviews.length > 0 ? "1px solid var(--w-divider)" : "none",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--w-text-muted)" }}>View all reviews on</span>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                {settings.googleReviewUrl && (
                  <a
                    href={settings.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#4285F4",
                      textDecoration: "none",
                    }}
                  >
                    <GoogleIcon size={14} />
                    Google
                  </a>
                )}
                {settings.googleReviewUrl && settings.yelpReviewUrl && (
                  <span style={{ color: "var(--w-divider)", fontSize: "14px" }}>|</span>
                )}
                {settings.yelpReviewUrl && (
                  <a
                    href={settings.yelpReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#d32323",
                      textDecoration: "none",
                    }}
                  >
                    <YelpIcon size={14} />
                    Yelp
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
