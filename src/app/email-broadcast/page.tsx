"use client";

import { useEffect, useState } from "react";

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

type RecipientSample = { id: string; email: string; name: string };

export default function EmailBroadcastPage() {
  const [subject, setSubject] = useState("News from {{shopName}}");
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sample, setSample] = useState<RecipientSample[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [livePreviewHtml, setLivePreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testToEmail, setTestToEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [banner, setBanner] = useState<{
    variant: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEST_TO_STORAGE_KEY);
      if (saved) setTestToEmail(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch("/api/email/broadcast")
      .then((res) => res.json())
      .then((data) => {
        setRecipientCount(
          typeof data.recipientCount === "number" ? data.recipientCount : 0
        );
        setSample(Array.isArray(data.sample) ? data.sample : []);
      })
      .catch(() => {
        setRecipientCount(0);
        setSample([]);
      })
      .finally(() => setRecipientsLoading(false));
  }, []);

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
          text: `Sent ${sent} email${sent === 1 ? "" : "s"}${
            skipped ? ` (${skipped} duplicate address${skipped === 1 ? "" : "es"} skipped)` : ""
          }, but ${failed} failed.`,
        });
      } else {
        setBanner({
          variant: "ok",
          text: `Sent to ${sent} customer${sent === 1 ? "" : "s"}${
            skipped ? ` (${skipped} duplicate address${skipped === 1 ? "" : "es"} skipped)` : ""
          }.`,
        });
      }
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="w-full max-w-6xl min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold text-indigo-950 mb-2">Email Broadcast</h1>
      <p className="text-slate-600 mb-2 break-words">
        Compose a news or updates email for customers who have email updates enabled. Messages use
        the same <strong>Bike Ops</strong> layout as transactional emails — write the inner content
        only; the shell is added automatically.
      </p>
      <p className="text-slate-600 mb-6 break-words text-sm">
        Merge fields:{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{customerName}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{shopName}}`}</code>.
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
        <p className="text-sm font-medium text-slate-900">
          {recipientsLoading
            ? "Loading recipients…"
            : `${recipientCount ?? 0} customer${
                recipientCount === 1 ? "" : "s"
              } with email updates enabled`}
        </p>
        {!recipientsLoading && sample.length > 0 && (
          <p className="mt-1 text-sm text-slate-600 break-words">
            Including{" "}
            {sample
              .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
              .join(", ")}
            {(recipientCount ?? 0) > sample.length ? "…" : ""}
          </p>
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
              This will email{" "}
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
