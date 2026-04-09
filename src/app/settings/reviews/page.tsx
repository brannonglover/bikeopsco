"use client";

import { useState, useEffect, useCallback } from "react";

interface ReviewLinks {
  googleReviewUrl: string;
  yelpReviewUrl: string;
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

function PlatformIcon({ platform }: { platform: "google" | "yelp" }) {
  if (platform === "google") {
    return (
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <path
        fill="#d32323"
        d="M20.16 12.73l-4.703 1.01a.425.425 0 01-.43-.616l2.453-4.12a.425.425 0 01.72-.038 9.193 9.193 0 012.388 4.248.425.425 0 01-.428.516zm-8.56 5.852l-1.548 4.516a.425.425 0 01-.773.066A9.194 9.194 0 017.3 18.19a.425.425 0 01.434-.648l4.36.946a.425.425 0 01.507.484zm7.06-9.72a9.195 9.195 0 00-3.57-2.724.425.425 0 00-.572.42l.22 4.794a.425.425 0 00.698.305l3.35-2.07a.425.425 0 00-.126-.725zM6.522 6.21a9.194 9.194 0 00-2.338 4.156.425.425 0 00.546.502l4.578-1.608a.425.425 0 00.14-.724L6.522 6.21zm-.21 7.524l-4.64.79a.425.425 0 00-.282.64 9.2 9.2 0 002.743 3.107.425.425 0 00.626-.203l1.974-3.924a.425.425 0 00-.422-.41zM12 2.75a9.25 9.25 0 100 18.5A9.25 9.25 0 0012 2.75z"
      />
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

export default function ReviewsSettingsPage() {
  const [links, setLinks] = useState<ReviewLinks>({
    googleReviewUrl: "",
    yelpReviewUrl: "",
  });
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [savingLinks, setSavingLinks] = useState(false);
  const [linksSaved, setLinksSaved] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);

  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/review-links");
      if (res.ok) {
        const data = await res.json();
        setLinks(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingLinks(false);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/review-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
    fetchRequests();
  }, [fetchLinks, fetchRequests]);

  const saveLinks = async () => {
    setSavingLinks(true);
    setLinksError(null);
    setLinksSaved(false);
    try {
      const res = await fetch("/api/settings/review-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(links),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinksError(data.error?.formErrors?.[0] ?? data.error ?? "Failed to save.");
        return;
      }
      setLinks(data);
      setLinksSaved(true);
      setTimeout(() => setLinksSaved(false), 3000);
    } catch {
      setLinksError("Something went wrong. Please try again.");
    } finally {
      setSavingLinks(false);
    }
  };

  const hasChanges =
    !loadingLinks &&
    (links.googleReviewUrl !== undefined || links.yelpReviewUrl !== undefined);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-1">Reviews</h1>
      <p className="text-text-secondary mb-8">
        Set up your review links and send review request emails to customers after a job.
      </p>

      {/* Review URL Configuration */}
      <section className="rounded-xl border border-surface-border bg-surface p-6 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Review Links</h2>
        <p className="text-sm text-text-secondary mb-5">
          Paste your Google Maps and/or Yelp review page URLs below. You can configure one
          or both — only configured platforms will appear in the email.
        </p>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="google-url"
              className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5"
            >
              <PlatformIcon platform="google" />
              Google Review URL
            </label>
            <input
              id="google-url"
              type="url"
              value={links.googleReviewUrl}
              onChange={(e) =>
                setLinks((prev) => ({ ...prev, googleReviewUrl: e.target.value }))
              }
              placeholder="https://g.page/r/..."
              className="w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors"
            />
            <p className="mt-1 text-xs text-text-secondary">
              Find this in Google Business Profile → &quot;Ask for reviews&quot;.
            </p>
          </div>

          <div>
            <label
              htmlFor="yelp-url"
              className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5"
            >
              <PlatformIcon platform="yelp" />
              Yelp Review URL
            </label>
            <input
              id="yelp-url"
              type="url"
              value={links.yelpReviewUrl}
              onChange={(e) =>
                setLinks((prev) => ({ ...prev, yelpReviewUrl: e.target.value }))
              }
              placeholder="https://www.yelp.com/writeareview/biz/..."
              className="w-full rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors"
            />
            <p className="mt-1 text-xs text-text-secondary">
              Find this on your Yelp business page → &quot;Write a Review&quot;.
            </p>
          </div>
        </div>

        {linksError && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{linksError}</p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={saveLinks}
            disabled={savingLinks || loadingLinks}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {savingLinks ? "Saving…" : "Save"}
          </button>
          {linksSaved && (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">
              Saved!
            </span>
          )}
        </div>
        {!hasChanges && !loadingLinks && !links.googleReviewUrl && !links.yelpReviewUrl && (
          <p className="mt-4 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Add at least one review URL to start sending review requests.
          </p>
        )}
      </section>

      {/* Sent Review Requests */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">Sent Requests</h2>
        <p className="text-sm text-text-secondary mb-4">
          History of review request emails sent to customers.
        </p>

        {loadingRequests ? (
          <div className="rounded-xl border border-surface-border bg-surface p-8 text-center text-sm text-text-secondary">
            Loading…
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-surface-border bg-surface p-8 text-center text-sm text-text-secondary">
            No review requests sent yet. Send one from a job using the &quot;Send Review Request&quot; button.
          </div>
        ) : (
          <div className="rounded-xl border border-surface-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-subtle-bg">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">
                    Customer
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">
                    Sent
                  </th>
                  <th className="text-center px-3 py-3 font-medium text-text-secondary">
                    <PlatformIcon platform="google" />
                    <span className="sr-only">Google clicked</span>
                  </th>
                  <th className="text-center px-3 py-3 font-medium text-text-secondary">
                    <PlatformIcon platform="yelp" />
                    <span className="sr-only">Yelp clicked</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {requests.map((req) => {
                  const name =
                    req.customer
                      ? [req.customer.firstName, req.customer.lastName]
                          .filter(Boolean)
                          .join(" ")
                      : req.recipientName || req.recipientEmail;
                  const sentDate = new Date(req.sentAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  return (
                    <tr key={req.id} className="bg-surface hover:bg-subtle-bg transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground truncate max-w-[200px]">
                          {name}
                        </div>
                        <div className="text-xs text-text-secondary truncate max-w-[200px]">
                          {req.recipientEmail}
                        </div>
                        {req.job && (
                          <div className="text-xs text-text-muted mt-0.5">
                            {req.job.bikeMake} {req.job.bikeModel}
                          </div>
                        )}
                        <div className="sm:hidden text-xs text-text-secondary mt-0.5">{sentDate}</div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary hidden sm:table-cell whitespace-nowrap">
                        {sentDate}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ClickBadge clicked={!!req.googleClickedAt} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ClickBadge clicked={!!req.yelpClickedAt} />
                      </td>
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
