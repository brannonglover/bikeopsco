import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function YelpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden>
      <path
        fill="#d32323"
        d="M20.16 12.73l-4.703 1.01a.425.425 0 01-.43-.616l2.453-4.12a.425.425 0 01.72-.038 9.193 9.193 0 012.388 4.248.425.425 0 01-.428.516zm-8.56 5.852l-1.548 4.516a.425.425 0 01-.773.066A9.194 9.194 0 017.3 18.19a.425.425 0 01.434-.648l4.36.946a.425.425 0 01.507.484zm7.06-9.72a9.195 9.195 0 00-3.57-2.724.425.425 0 00-.572.42l.22 4.794a.425.425 0 00.698.305l3.35-2.07a.425.425 0 00-.126-.725zM6.522 6.21a9.194 9.194 0 00-2.338 4.156.425.425 0 00.546.502l4.578-1.608a.425.425 0 00.14-.724L6.522 6.21zm-.21 7.524l-4.64.79a.425.425 0 00-.282.64 9.2 9.2 0 002.743 3.107.425.425 0 00.626-.203l1.974-3.924a.425.425 0 00-.422-.41zM12 2.75a9.25 9.25 0 100 18.5A9.25 9.25 0 0012 2.75z"
      />
    </svg>
  );
}

export default async function ReviewWidget() {
  const [settings, totalSent, googleClicks, yelpClicks] = await Promise.all([
    prisma.reviewSettings.findUnique({ where: { id: "default" } }),
    prisma.reviewRequest.count(),
    prisma.reviewRequest.count({ where: { googleClickedAt: { not: null } } }),
    prisma.reviewRequest.count({ where: { yelpClickedAt: { not: null } } }),
  ]);

  const googleUrl = settings?.googleReviewUrl;
  const yelpUrl = settings?.yelpReviewUrl;
  const totalClicks = googleClicks + yelpClicks;

  const hasPlatforms = googleUrl || yelpUrl;

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent p-3">
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 2px 16px rgba(0,0,0,0.10)",
          padding: "24px 28px",
          maxWidth: "360px",
          width: "100%",
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          border: "1px solid #e5e7eb",
        }}
      >
        {/* Stars */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} style={{ color: "#f59e0b" }}>
              <StarIcon />
            </span>
          ))}
        </div>

        {/* Headline */}
        <p
          style={{
            fontSize: "17px",
            fontWeight: 700,
            color: "#111827",
            margin: "0 0 4px 0",
            lineHeight: 1.3,
          }}
        >
          Happy customers love us
        </p>

        {/* Sub-copy */}
        {totalSent > 0 ? (
          <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 18px 0" }}>
            {totalSent} customer{totalSent !== 1 ? "s" : ""} invited to leave a review
            {totalClicks > 0
              ? ` · ${totalClicks} clicked through`
              : null}
          </p>
        ) : (
          <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 18px 0" }}>
            Join our growing list of happy customers.
          </p>
        )}

        {/* Platform buttons */}
        {hasPlatforms && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {googleUrl && (
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1.5px solid #e5e7eb",
                  background: "#f9fafb",
                  textDecoration: "none",
                  color: "#111827",
                  fontSize: "14px",
                  fontWeight: 600,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f9fafb")}
              >
                <GoogleIcon />
                <span>Review us on Google</span>
                <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: "16px" }}>→</span>
              </a>
            )}
            {yelpUrl && (
              <a
                href={yelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1.5px solid #e5e7eb",
                  background: "#f9fafb",
                  textDecoration: "none",
                  color: "#111827",
                  fontSize: "14px",
                  fontWeight: 600,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f9fafb")}
              >
                <YelpIcon />
                <span>Review us on Yelp</span>
                <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: "16px" }}>→</span>
              </a>
            )}
          </div>
        )}

        {!hasPlatforms && (
          <p style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
            Review links coming soon.
          </p>
        )}
      </div>
    </div>
  );
}
