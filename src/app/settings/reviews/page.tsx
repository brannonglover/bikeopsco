"use client";

import { useState, useEffect, useCallback } from "react";

interface FeaturedReview {
  id: string;
  platform: "google" | "yelp";
  author: string;
  text: string;
  rating: number;
}

interface ReviewSettings {
  googleReviewUrl: string;
  yelpReviewUrl: string;
  googlePlaceId: string;
  yelpAlias: string;
  featuredReviews: FeaturedReview[];
}

interface ReviewRequest {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  sentAt: string;
  googleClickedAt: string | null;
  yelpClickedAt: string | null;
  customer: { firstName: string; lastName: string | null } | null;
  job: { id: string; bikeMake: string; bikeModel: string } | null;
}

interface ReviewStats {
  totalSent: number;
  googleClicks: number;
  yelpClicks: number;
  anyClick: number;
}

interface ApiStatus {
  googlePlacesApiConfigured: boolean;
  yelpApiConfigured: boolean;
}

interface LivePlatformStats {
  rating: number;
  reviewCount: number;
}

interface LiveReviewStats {
  google: LivePlatformStats | null;
  yelp: LivePlatformStats | null;
}

function PlatformIcon({ platform }: { platform: "google" | "yelp" }) {
  if (platform === "google") {
    return (
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <path fill="#d32323" d="M20.16 12.73l-4.703 1.01a.425.425 0 01-.43-.616l2.453-4.12a.425.425 0 01.72-.038 9.193 9.193 0 012.388 4.248.425.425 0 01-.428.516zm-8.56 5.852l-1.548 4.516a.425.425 0 01-.773.066A9.194 9.194 0 017.3 18.19a.425.425 0 01.434-.648l4.36.946a.425.425 0 01.507.484zm7.06-9.72a9.195 9.195 0 00-3.57-2.724.425.425 0 00-.572.42l.22 4.794a.425.425 0 00.698.305l3.35-2.07a.425.425 0 00-.126-.725zM6.522 6.21a9.194 9.194 0 00-2.338 4.156.425.425 0 00.546.502l4.578-1.608a.425.425 0 00.14-.724L6.522 6.21zm-.21 7.524l-4.64.79a.425.425 0 00-.282.64 9.2 9.2 0 002.743 3.107.425.425 0 00.626-.203l1.974-3.924a.425.425 0 00-.422-.41zM12 2.75a9.25 9.25 0 100 18.5A9.25 9.25 0 0012 2.75z" />
    </svg>
  );
}

function ClickBadge({ clicked }: { clicked: boolean }) {
  if (clicked) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
          <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
        </svg>
        Clicked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-text-secondary border border-surface-border">
      Not yet
    </span>
  );
}

function StatCard({ label, value, sub, accent }: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "blue" | "red";
}) {
  const accentClass =
    accent === "green" ? "text-green-600 dark:text-green-400"
    : accent === "blue" ? "text-blue-600 dark:text-blue-400"
    : accent === "red" ? "text-red-500 dark:text-red-400"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4 flex flex-col gap-1">
      <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function pct(clicks: number, sent: number) {
  if (sent === 0) return "—";
  return `${Math.round((clicks / sent) * 100)}%`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
      }}
      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ApiKeyBadge({ configured, label }: { configured: boolean; label: string }) {
  if (configured) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
          <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
        </svg>
        {label} connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 12 12">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 1v4.5M6 8.5V11M2 6a4 4 0 108 0 4 4 0 00-8 0z" />
      </svg>
      {label} key missing
    </span>
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const inputCls =
  "w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors";

export default function ReviewsSettingsPage() {
  const [settings, setSettings] = useState<ReviewSettings>({
    googleReviewUrl: "",
    yelpReviewUrl: "",
    googlePlaceId: "",
    yelpAlias: "",
    featuredReviews: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [liveReviewStats, setLiveReviewStats] = useState<LiveReviewStats | null>(null);
  const [loadingLiveStats, setLoadingLiveStats] = useState(true);
  const [widgetOrigin, setWidgetOrigin] = useState("");

  useEffect(() => { setWidgetOrigin(window.location.origin); }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/review-links");
      if (res.ok) setSettings(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/review-requests");
      if (res.ok) setRequests(await res.json());
    } catch { /* ignore */ } finally { setLoadingRequests(false); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/review-requests/stats");
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ } finally { setLoadingStats(false); }
  }, []);

  const fetchApiStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/review-api-status");
      if (res.ok) setApiStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchLiveReviewStats = useCallback(async () => {
    try {
      const res = await fetch("/api/widget/reviews");
      if (res.ok) {
        const data = await res.json();
        setLiveReviewStats({
          google: data.google ?? null,
          yelp: data.yelp ?? null,
        });
      }
    } catch { /* ignore */ } finally { setLoadingLiveStats(false); }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchRequests();
    fetchStats();
    fetchApiStatus();
    fetchLiveReviewStats();
  }, [fetchSettings, fetchRequests, fetchStats, fetchApiStatus, fetchLiveReviewStats]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/review-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleReviewUrl: settings.googleReviewUrl,
          yelpReviewUrl: settings.yelpReviewUrl,
          googlePlaceId: settings.googlePlaceId,
          featuredReviews: settings.featuredReviews,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error?.formErrors?.[0] ?? data.error ?? "Failed to save.");
        return;
      }
      setSettings(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addFeaturedReview = () => {
    setSettings((prev) => ({
      ...prev,
      featuredReviews: [...prev.featuredReviews, { id: uid(), platform: "google", author: "", text: "", rating: 5 }],
    }));
  };

  const updateFeaturedReview = (id: string, patch: Partial<FeaturedReview>) => {
    setSettings((prev) => ({
      ...prev,
      featuredReviews: prev.featuredReviews.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const removeFeaturedReview = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      featuredReviews: prev.featuredReviews.filter((r) => r.id !== id),
    }));
  };

  const iframeCode = widgetOrigin
    ? `<iframe\n  src="${widgetOrigin}/widget/reviews"\n  width="420"\n  height="auto"\n  frameborder="0"\n  style="border:none;border-radius:16px;width:100%;max-width:420px;"\n  title="Customer Reviews"\n></iframe>`
    : "";

  const apiUrl = widgetOrigin ? `${widgetOrigin}/api/widget/reviews` : "";

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-1">Reviews</h1>
      <p className="text-text-secondary mb-8">
        Configure your review links and embed a live social proof widget on your marketing site.
      </p>

      {/* ── Live Review Fetching ── */}
      <section className="rounded-xl border border-surface-border bg-surface p-6 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Live Review Fetching</h2>
        <p className="text-sm text-text-secondary mb-5">
          Connect your Google Places API and Yelp API keys to automatically pull real ratings and reviews into your widget — no manual entry needed. Both are free tiers that take about 5 minutes to set up.
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          {apiStatus ? (
            <>
              <ApiKeyBadge configured={apiStatus.googlePlacesApiConfigured} label="Google Places API" />
              <ApiKeyBadge configured={apiStatus.yelpApiConfigured} label="Yelp API" />
            </>
          ) : (
            <div className="h-7 w-48 rounded-full bg-surface-border animate-pulse" />
          )}
        </div>

        {apiStatus && (!apiStatus.googlePlacesApiConfigured || !apiStatus.yelpApiConfigured) && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 space-y-2">
            {!apiStatus.googlePlacesApiConfigured && (
              <p>
                <strong>Google:</strong>{" "}
                <a
                  href="https://console.cloud.google.com/apis/library/places-backend.googleapis.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Enable the Places API (New)
                </a>
                {" "}→ Credentials → Create API Key → add as{" "}
                <code className="font-mono text-xs bg-amber-100 dark:bg-amber-800/40 px-1 rounded">GOOGLE_PLACES_API_KEY</code>{" "}
                in your <code className="font-mono text-xs bg-amber-100 dark:bg-amber-800/40 px-1 rounded">.env</code>.
              </p>
            )}
            {!apiStatus.yelpApiConfigured && (
              <p>
                <strong>Yelp:</strong>{" "}
                <a
                  href="https://docs.developer.yelp.com/docs/fusion-intro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Create a Yelp app
                </a>
                {" "}→ copy the API Key → add as{" "}
                <code className="font-mono text-xs bg-amber-100 dark:bg-amber-800/40 px-1 rounded">YELP_API_KEY</code>{" "}
                in your <code className="font-mono text-xs bg-amber-100 dark:bg-amber-800/40 px-1 rounded">.env</code>.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Review Links ── */}
      <section className="rounded-xl border border-surface-border bg-surface p-6 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Review Links</h2>
        <p className="text-sm text-text-secondary mb-5">
          Paste your write-review URLs. The Yelp business alias is extracted automatically. For Google, the Place ID is auto-detected when possible — or enter it below.
        </p>

        <div className="space-y-5">
          {/* Google URL */}
          <div>
            <label htmlFor="google-url" className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
              <PlatformIcon platform="google" /> Google Review URL
            </label>
            <input
              id="google-url"
              type="url"
              value={settings.googleReviewUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, googleReviewUrl: e.target.value, googlePlaceId: "" }))}
              placeholder="https://g.page/r/... or https://search.google.com/local/writereview?placeid=..."
              className={inputCls}
            />
            <p className="mt-1 text-xs text-text-secondary">
              Find this in Google Business Profile → &quot;Ask for reviews&quot;.
            </p>
          </div>

          {/* Google Place ID */}
          <div>
            <label htmlFor="place-id" className="text-sm font-medium text-foreground mb-1.5 block">
              Google Place ID
            </label>
            <div className="flex items-center gap-2">
              <input
                id="place-id"
                type="text"
                value={settings.googlePlaceId}
                onChange={(e) => setSettings((prev) => ({ ...prev, googlePlaceId: e.target.value }))}
                placeholder="ChIJ... (auto-detected on save, or paste manually)"
                className={inputCls}
              />
            </div>
            {settings.googlePlaceId ? (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">
                ✓ Place ID set — Google reviews will load automatically.
              </p>
            ) : settings.googleReviewUrl ? (
              <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-medium mb-1">Place ID not detected — Google reviews won&apos;t load.</p>
                <p>
                  Open your Google Review URL in a browser. It will redirect to a URL like{" "}
                  <code className="font-mono bg-amber-100 dark:bg-amber-800/40 px-1 rounded">
                    search.google.com/local/writereview?placeid=ChIJ...
                  </code>
                  {" "}— copy the value after <code className="font-mono bg-amber-100 dark:bg-amber-800/40 px-1 rounded">placeid=</code> and paste it in the field above.
                  Or use the{" "}
                  <a
                    href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    Place ID Finder
                  </a>
                  .
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-text-secondary">
                If auto-detection doesn&apos;t work, find your Place ID at{" "}
                <a
                  href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 underline"
                >
                  developers.google.com
                </a>
                .
              </p>
            )}
          </div>

          {/* Yelp URL */}
          <div>
            <label htmlFor="yelp-url" className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
              <PlatformIcon platform="yelp" /> Yelp Review URL
            </label>
            <input
              id="yelp-url"
              type="url"
              value={settings.yelpReviewUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, yelpReviewUrl: e.target.value }))}
              placeholder="https://www.yelp.com/writeareview/biz/..."
              className={inputCls}
            />
            {settings.yelpAlias && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">
                ✓ Business alias detected: <code className="font-mono">{settings.yelpAlias}</code> — Yelp reviews will load automatically.
              </p>
            )}
            {!settings.yelpAlias && settings.yelpReviewUrl && (
              <p className="mt-1 text-xs text-text-secondary">
                Find this on your Yelp business page → &quot;Write a Review&quot;.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Pinned Reviews ── */}
      <section className="rounded-xl border border-surface-border bg-surface p-6 mb-8">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-base font-semibold text-foreground">Pinned Reviews</h2>
          </div>
          {settings.featuredReviews.length < 6 && (
            <button type="button" onClick={addFeaturedReview} className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
              + Add
            </button>
          )}
        </div>
        <p className="text-sm text-text-secondary mb-5">
          Optional: paste 1–6 specific reviews to always show in the widget. Used as a fallback when API keys aren&apos;t set, or to highlight your best reviews.
        </p>

        {settings.featuredReviews.length === 0 ? (
          <button
            type="button"
            onClick={addFeaturedReview}
            className="w-full rounded-lg border-2 border-dashed border-surface-border py-5 text-sm text-text-secondary hover:border-primary-400 hover:text-primary-600 transition-colors"
          >
            + Add a pinned review
          </button>
        ) : (
          <div className="space-y-4">
            {settings.featuredReviews.map((review, idx) => (
              <div key={review.id} className="rounded-lg border border-surface-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">Review {idx + 1}</span>
                  <button type="button" onClick={() => removeFeaturedReview(review.id)} className="text-xs text-red-500 hover:text-red-600 transition-colors">Remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">Platform</label>
                    <select value={review.platform} onChange={(e) => updateFeaturedReview(review.id, { platform: e.target.value as "google" | "yelp" })} className={inputCls}>
                      <option value="google">Google</option>
                      <option value="yelp">Yelp</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">Rating</label>
                    <select value={review.rating} onChange={(e) => updateFeaturedReview(review.id, { rating: parseInt(e.target.value, 10) })} className={inputCls}>
                      {[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{"★".repeat(v)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">Author</label>
                    <input type="text" value={review.author} onChange={(e) => updateFeaturedReview(review.id, { author: e.target.value })} placeholder="Jane D." maxLength={80} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Review text</label>
                  <textarea value={review.text} onChange={(e) => updateFeaturedReview(review.id, { text: e.target.value })} placeholder="Paste the review text here…" rows={3} maxLength={500} className={`${inputCls} resize-none`} />
                  <p className="mt-0.5 text-right text-xs text-text-muted">{review.text.length}/500</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Save */}
      <div className="mb-8 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400 font-medium">Saved!</span>}
        {saveError && <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>}
      </div>

      {/* ── Marketing Widget ── */}
      <section className="rounded-xl border border-surface-border bg-surface p-6 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Marketing Widget</h2>
        <p className="text-sm text-text-secondary mb-5">
          Embed this on your marketing website — it shows live ratings, real customer reviews, and links to leave a review.
        </p>

        <div className="mb-5">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Preview</p>
          <div className="rounded-xl border border-surface-border bg-subtle-bg p-4 flex justify-center">
            {widgetOrigin ? (
              <iframe
                src={`${widgetOrigin}/widget/reviews`}
                style={{ border: "none", borderRadius: "16px", display: "block", width: "100%", maxWidth: "420px", minHeight: "120px" }}
                title="Review Widget Preview"
              />
            ) : (
              <div className="h-32 w-full max-w-sm rounded-xl bg-surface-border animate-pulse" />
            )}
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Embed code</p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 min-w-0 rounded-lg bg-background border border-surface-border px-3 py-2.5 text-xs text-foreground font-mono whitespace-pre overflow-x-auto" suppressHydrationWarning>{iframeCode || null}</pre>
            {iframeCode && <CopyButton text={iframeCode} />}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">JSON API</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 rounded-lg bg-background border border-surface-border px-3 py-2 text-xs text-foreground font-mono truncate" suppressHydrationWarning>{apiUrl || null}</code>
            {apiUrl && <CopyButton text={apiUrl} />}
          </div>
        </div>
      </section>

      {/* ── Review Tally ── */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Review Tally</h2>
        <p className="text-sm text-text-secondary mb-4">Live ratings from Google and Yelp, plus all-time summary of review request emails sent.</p>

        {/* Live platform stats */}
        {loadingLiveStats ? (
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[1, 2].map((i) => <div key={i} className="rounded-xl border border-surface-border bg-surface p-4 h-20 animate-pulse" />)}
          </div>
        ) : (liveReviewStats?.google || liveReviewStats?.yelp) ? (
          <div className="grid grid-cols-2 gap-3 mb-3">
            {liveReviewStats.google && (
              <StatCard
                label="Google Reviews"
                value={liveReviewStats.google.reviewCount.toLocaleString()}
                sub={`${liveReviewStats.google.rating.toFixed(1)}★ avg rating`}
                accent="blue"
              />
            )}
            {liveReviewStats.yelp && (
              <StatCard
                label="Yelp Reviews"
                value={liveReviewStats.yelp.reviewCount.toLocaleString()}
                sub={`${liveReviewStats.yelp.rating.toFixed(1)}★ avg rating`}
                accent="red"
              />
            )}
          </div>
        ) : null}

        {loadingStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="rounded-xl border border-surface-border bg-surface p-4 h-20 animate-pulse" />)}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Requests Sent" value={stats.totalSent} sub="all time" />
            <StatCard label="Google Clicks" value={stats.googleClicks} sub={`${pct(stats.googleClicks, stats.totalSent)} click-through`} accent="blue" />
            <StatCard label="Yelp Clicks" value={stats.yelpClicks} sub={`${pct(stats.yelpClicks, stats.totalSent)} click-through`} accent="red" />
            <StatCard label="Any Click" value={stats.anyClick} sub={`${pct(stats.anyClick, stats.totalSent)} engagement`} accent="green" />
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Could not load stats.</p>
        )}
      </section>

      {/* ── Sent Requests ── */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">Sent Requests</h2>
        <p className="text-sm text-text-secondary mb-4">History of review request emails sent to customers.</p>

        {loadingRequests ? (
          <div className="rounded-xl border border-surface-border bg-surface p-8 text-center text-sm text-text-secondary">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-surface-border bg-surface p-8 text-center text-sm text-text-secondary">
            No review requests sent yet. Send one from a job using the &quot;Send Review Request&quot; button.
          </div>
        ) : (
          <div className="rounded-xl border border-surface-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-subtle-bg">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Sent</th>
                  <th className="text-center px-3 py-3 font-medium text-text-secondary"><PlatformIcon platform="google" /><span className="sr-only">Google</span></th>
                  <th className="text-center px-3 py-3 font-medium text-text-secondary"><PlatformIcon platform="yelp" /><span className="sr-only">Yelp</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {requests.map((req) => {
                  const name = req.customer
                    ? [req.customer.firstName, req.customer.lastName].filter(Boolean).join(" ")
                    : req.recipientName || req.recipientEmail;
                  const sentDate = new Date(req.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <tr key={req.id} className="bg-surface hover:bg-subtle-bg transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground truncate max-w-[200px]">{name}</div>
                        <div className="text-xs text-text-secondary truncate max-w-[200px]">{req.recipientEmail}</div>
                        {req.job && <div className="text-xs text-text-muted mt-0.5">{req.job.bikeMake} {req.job.bikeModel}</div>}
                        <div className="sm:hidden text-xs text-text-secondary mt-0.5">{sentDate}</div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary hidden sm:table-cell whitespace-nowrap">{sentDate}</td>
                      <td className="px-3 py-3 text-center"><ClickBadge clicked={!!req.googleClickedAt} /></td>
                      <td className="px-3 py-3 text-center"><ClickBadge clicked={!!req.yelpClickedAt} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
