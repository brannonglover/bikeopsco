"use client";

import { useCallback, useEffect, useState } from "react";
import { SkeletonPulse } from "@/components/ui/Skeleton";

const PREVIEW_IFRAME_CLASS =
  "w-full min-h-[min(70vh,720px)] h-[min(70vh,720px)] bg-white block border-0";

const TEST_TO_STORAGE_KEY = "bikeops-email-broadcast-test-to";

const DEFAULT_BODY = `<p>Hi {{customerName}},</p>
<p>We've got some news to share from {{shopName}}.</p>
<p></p>
<p>Thanks,<br/>The {{shopName}} Team</p>`;

function isLikelyEmail(value: string): boolean {
  const t = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type RecipientSample = { id: string; email: string; name: string };

type BroadcastHistoryItem = {
  id: string;
  subject: string;
  bodyHtml: string;
  recipientCount: number;
  failedCount: number;
  skippedCount: number;
  resendBroadcastId: string | null;
  sentAt: string;
};

export default function EmailBroadcastPage() {
  const [subject, setSubject] = useState("News from {{shopName}}");
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sample, setSample] = useState<RecipientSample[]>([]);
  const [history, setHistory] = useState<BroadcastHistoryItem[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [livePreviewHtml, setLivePreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testToEmail, setTestToEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    variant: "ok" | "error";
    text: string;
  } | null>(null);

  const loadBroadcastMeta = useCallback(async () => {
    setRecipientsLoading(true);
    try {
      const res = await fetch("/api/email/broadcast");
      const data = await res.json();
      setRecipientCount(
        typeof data.recipientCount === "number" ? data.recipientCount : 0
      );
      setSample(Array.isArray(data.sample) ? data.sample : []);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      setRecipientCount(0);
      setSample([]);
      setHistory([]);
    } finally {
      setRecipientsLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEST_TO_STORAGE_KEY);
      if (saved) setTestToEmail(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadBroadcastMeta();
  }, [loadBroadcastMeta]);

  useEffect(() => {
    setPreviewLoading(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/email-templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyHtml }),
        });
        if (cancelled) return;
        if (res.ok) {
          setLivePreviewHtml(await res.text());
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [bodyHtml]);

  const persistTestToEmail = () => {
    try {
      const t = testToEmail.trim();
      if (t) localStorage.setItem(TEST_TO_STORAGE_KEY, t);
    } catch {
      // ignore
    }
  };

  const loadIntoComposer = (item: BroadcastHistoryItem) => {
    setSubject(item.subject);
    setBodyHtml(item.bodyHtml);
    setBanner({
      variant: "ok",
      text: "Loaded into composer. Edit and send again if you want.",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sendTestEmail = async () => {
    const to = testToEmail.trim();
    if (!isLikelyEmail(to)) {
      setBanner({
        variant: "error",
        text: "Enter a valid email address to send a test.",
      });
      return;
    }
    if (!subject.trim() || !bodyHtml.trim()) {
      setBanner({
        variant: "error",
        text: "Subject and message body are required.",
      });
      return;
    }
    setBanner(null);
    setSendingTest(true);
    try {
      const res = await fetch("/api/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "test",
          subject: subject.trim(),
          bodyHtml,
          to,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setBanner({
          variant: "error",
          text: data.error ?? "Could not send test email.",
        });
        return;
      }
      setBanner({
        variant: "ok",
        text: `Test email sent to ${to}. The subject includes "[test]". Check inbox and spam.`,
      });
    } finally {
      setSendingTest(false);
    }
  };

  const sendBroadcast = async () => {
    if (!subject.trim() || !bodyHtml.trim()) {
      setBanner({
        variant: "error",
        text: "Subject and message body are required.",
      });
      setConfirmOpen(false);
      return;
    }
    setBanner(null);
    setSending(true);
    try {
      const res = await fetch("/api/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "send",
          subject: subject.trim(),
          bodyHtml,
          confirm: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        failed?: number;
        skipped?: number;
        broadcastId?: string;
      };
      if (!res.ok) {
        setBanner({
          variant: "error",
          text:
            data.error ??
            (typeof data.sent === "number"
              ? `Sent ${data.sent}, failed ${data.failed ?? 0}.`
              : "Broadcast failed."),
        });
        return;
      }
      const sent = data.sent ?? 0;
      const failed = data.failed ?? 0;
      const skipped = data.skipped ?? 0;
      if (failed > 0) {
        setBanner({
          variant: "error",
          text: `Marketing broadcast queued for ${sent} contact${sent === 1 ? "" : "s"}${
            skipped ? ` (${skipped} duplicate address${skipped === 1 ? "" : "es"} skipped)` : ""
          }, but ${failed} contact sync failed.`,
        });
      } else {
        setBanner({
          variant: "ok",
          text: `Marketing broadcast queued for ${sent} customer${sent === 1 ? "" : "s"}${
            skipped ? ` (${skipped} duplicate address${skipped === 1 ? "" : "es"} skipped)` : ""
          }. Delivery is handled by Resend.`,
        });
      }
      await loadBroadcastMeta();
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold text-indigo-950 mb-2">Email Broadcast</h1>
      <p className="text-slate-600 mb-2 break-words">
        Compose a news or updates email for customers who have email updates enabled. Messages use
        the same <strong>Bike Ops</strong> layout as transactional emails — write the inner content
        only; the shell is added automatically.
      </p>
      <p className="text-slate-600 mb-2 break-words text-sm">
        Mass sends use your Resend <strong>Marketing</strong> plan (Broadcasts), so they do not count
        against the transactional daily limit. Test emails still use transactional sending.
      </p>
      <p className="text-slate-600 mb-6 break-words text-sm">
        Merge fields:{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{customerName}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{shopName}}`}</code>.
        Recipients get a Resend unsubscribe link in the footer.
      </p>

      {banner && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            banner.variant === "ok"
              ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
              : "bg-red-50 text-red-900 border border-red-200"
          }`}
          role="status"
        >
          {banner.text}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {recipientsLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading recipients">
            <SkeletonPulse className="h-4 w-64" />
            <SkeletonPulse className="h-3 w-80 max-w-full" />
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-900">
              {`${recipientCount ?? 0} customer${
                recipientCount === 1 ? "" : "s"
              } with email updates enabled`}
            </p>
            {sample.length > 0 && (
              <p className="mt-1 text-sm text-slate-600 break-words">
                Including{" "}
                {sample
                  .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
                  .join(", ")}
                {(recipientCount ?? 0) > sample.length ? "…" : ""}
              </p>
            )}
          </>
        )}
      </div>

      <section className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <h2 className="font-semibold text-slate-900">Compose</h2>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={testToEmail}
              onChange={(e) => setTestToEmail(e.target.value)}
              onBlur={persistTestToEmail}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg w-52"
            />
            <button
              type="button"
              onClick={sendTestEmail}
              disabled={!isLikelyEmail(testToEmail) || sendingTest || sending}
              className="text-sm px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingTest ? "Sending…" : "Send test email"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={
                sending ||
                sendingTest ||
                recipientsLoading ||
                !recipientCount ||
                !subject.trim() ||
                !bodyHtml.trim()
              }
              className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send to all
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:divide-x lg:divide-slate-200">
          <div className="lg:col-span-7 p-4 lg:p-5">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Live preview (Bike Ops template)
            </p>
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shadow-inner">
              {previewLoading && !livePreviewHtml ? (
                <div
                  className={`${PREVIEW_IFRAME_CLASS} flex items-center justify-center text-slate-500 text-sm`}
                >
                  Updating preview…
                </div>
              ) : (
                <iframe
                  title="Broadcast email preview"
                  className={PREVIEW_IFRAME_CLASS}
                  srcDoc={livePreviewHtml}
                />
              )}
            </div>
          </div>

          <div className="lg:col-span-5 p-4 lg:p-5 bg-slate-50/50 border-t lg:border-t-0 border-slate-200">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="broadcast-subject"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Subject line
                </label>
                <input
                  id="broadcast-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="broadcast-body"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Message HTML
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Inner content only. The preview shows the full email customers get.
                </p>
                <textarea
                  id="broadcast-body"
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  spellCheck={false}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono bg-white min-h-[min(50vh,420px)] resize-y"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <h2 className="font-semibold text-slate-900">Sent history</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Past mass sends for this shop. Open one to review, or load it back into the composer.
          </p>
        </div>
        {recipientsLoading ? (
          <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading history">
            <SkeletonPulse className="h-12 w-full" />
            <SkeletonPulse className="h-12 w-full" />
          </div>
        ) : history.length === 0 ? (
          <p className="p-4 text-sm text-slate-600">No broadcasts sent yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((item) => {
              const expanded = expandedHistoryId === item.id;
              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 break-words">
                        {item.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatSentAt(item.sentAt)} · {item.recipientCount} recipient
                        {item.recipientCount === 1 ? "" : "s"}
                        {item.failedCount > 0 ? ` · ${item.failedCount} sync failed` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedHistoryId(expanded ? null : item.id)
                        }
                        className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                      >
                        {expanded ? "Hide" : "View"}
                      </button>
                      <button
                        type="button"
                        onClick={() => loadIntoComposer(item)}
                        className="text-sm px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100"
                      >
                        Reuse
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap break-words font-mono">
                      {item.bodyHtml}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="broadcast-confirm-title"
              className="text-lg font-semibold text-slate-900"
            >
              Send to all customers?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will send a Resend Marketing Broadcast to{" "}
              <strong>
                {recipientCount} customer{recipientCount === 1 ? "" : "s"}
              </strong>{" "}
              who have email updates enabled. Subject:{" "}
              <span className="font-medium text-slate-800">{subject.trim()}</span>
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
                className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendBroadcast}
                disabled={sending}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Confirm send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
