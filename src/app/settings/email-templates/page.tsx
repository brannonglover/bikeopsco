"use client";

import { useState, useEffect } from "react";

interface EmailTemplate {
  id: string;
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  triggerType: string;
}

const PREVIEW_IFRAME_CLASS =
  "w-full min-h-[min(70vh,720px)] h-[min(70vh,720px)] bg-white block border-0";

const TEST_TO_STORAGE_KEY = "bikeops-email-templates-test-to";

function isLikelyEmail(value: string): boolean {
  const t = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [livePreviewHtml, setLivePreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testToEmail, setTestToEmail] = useState("");
  const [sendingTestSlug, setSendingTestSlug] = useState<string | null>(null);
  const [testBanner, setTestBanner] = useState<{
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

  const persistTestToEmail = () => {
    try {
      const t = testToEmail.trim();
      if (t) localStorage.setItem(TEST_TO_STORAGE_KEY, t);
    } catch {
      // ignore
    }
  };

  const sendTestEmail = async (slug: string) => {
    const to = testToEmail.trim();
    if (!isLikelyEmail(to)) {
      setTestBanner({
        variant: "error",
        text: "Enter a valid email in “Send test emails to” above.",
      });
      return;
    }
    setTestBanner(null);
    setSendingTestSlug(slug);
    try {
      const res = await fetch("/api/email-templates/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, to }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTestBanner({
          variant: "error",
          text: data.error ?? "Could not send test email.",
        });
        return;
      }
      setTestBanner({
        variant: "ok",
        text: `Test email sent to ${to}. The subject includes “[test]”. Check inbox and spam.`,
      });
    } finally {
      setSendingTestSlug(null);
    }
  };

  useEffect(() => {
    fetch("/api/email-templates")
      .then((res) => res.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!editing) {
      setLivePreviewHtml("");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/email-templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyHtml: editBody }),
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
  }, [editBody, editing]);

  const startEdit = (t: EmailTemplate) => {
    setEditing(t.slug);
    setEditSubject(t.subject);
    setEditBody(t.bodyHtml);
    setLivePreviewHtml("");
    setPreviewLoading(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setLivePreviewHtml("");
    setPreviewLoading(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch("/api/email-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: editing,
          subject: editSubject,
          bodyHtml: editBody,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTemplates((prev) =>
          prev.map((t) => (t.slug === updated.slug ? updated : t))
        );
        setEditing(null);
        setLivePreviewHtml("");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading templates...</div>
    );
  }

  return (
    <div className="w-full max-w-6xl min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold text-indigo-950 mb-2">Email Templates</h1>
      <p className="text-slate-600 mb-2 break-words">
        Each card shows a <strong>live simulation</strong> of what customers receive (Bike Ops layout +
        sample names and a demo status link). The stored template is only the message body; the shell is
        added automatically when emails send.
      </p>
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label
          htmlFor="email-templates-test-to"
          className="block text-sm font-medium text-slate-800 mb-1"
        >
          Send test emails to
        </label>
        <input
          id="email-templates-test-to"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={testToEmail}
          onChange={(e) => setTestToEmail(e.target.value)}
          onBlur={persistTestToEmail}
          className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg"
        />
        <p className="mt-2 text-xs text-slate-500">
          Saved in this browser. Each template’s <strong>Send test email</strong> uses the saved template
          from the database (save your edits first). Sample merge data matches the on-page preview.
        </p>
      </div>

      {testBanner && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            testBanner.variant === "ok"
              ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
              : "bg-red-50 text-red-900 border border-red-200"
          }`}
          role="status"
        >
          {testBanner.text}
        </div>
      )}

      <p className="text-slate-600 mb-6 break-words text-sm">
        Merge fields:{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{customerName}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{bikeMake}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{bikeModel}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{shopName}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{statusButtonHtml}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{statusUrl}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{customerNotes}}`}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{rejectionReason}}`}</code>. Edit the HTML in the
        side panel while you watch the preview update.
      </p>

      <div className="space-y-10">
        {templates.map((t) => {
          const isEditing = editing === t.slug;

          return (
            <section
              key={t.id}
              className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900 truncate">{t.name}</h2>
                  {!isEditing && (
                    <p className="text-sm text-slate-600 mt-0.5 truncate" title={t.subject}>
                      <span className="font-medium text-slate-800">Subject:</span> {t.subject}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => sendTestEmail(t.slug)}
                        disabled={
                          !isLikelyEmail(testToEmail) || sendingTestSlug === t.slug
                        }
                        title={
                          !isLikelyEmail(testToEmail)
                            ? "Add a valid email above"
                            : "Sends the saved template with sample data and full layout"
                        }
                        className="text-sm px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sendingTestSlug === t.slug ? "Sending…" : "Send test email"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
                      >
                        Edit template
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={saving}
                        className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div
                className={
                  isEditing
                    ? "grid grid-cols-1 lg:grid-cols-12 gap-0 lg:divide-x lg:divide-slate-200"
                    : "p-4"
                }
              >
                {/* Rendered email simulation — always the focus */}
                <div className={isEditing ? "lg:col-span-7 p-4 lg:p-5" : ""}>
                  {!isEditing && (
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                      Simulated customer inbox
                    </p>
                  )}
                  {isEditing && (
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                      Live preview (updates as you edit)
                    </p>
                  )}
                  <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shadow-inner">
                    {isEditing ? (
                      previewLoading && !livePreviewHtml ? (
                        <div
                          className={`${PREVIEW_IFRAME_CLASS} flex items-center justify-center text-slate-500 text-sm`}
                        >
                          Updating preview…
                        </div>
                      ) : (
                        <iframe
                          title={isEditing ? `Live preview: ${t.name}` : `Preview: ${t.name}`}
                          className={PREVIEW_IFRAME_CLASS}
                          srcDoc={livePreviewHtml}
                        />
                      )
                    ) : (
                      <iframe
                        key={`${t.id}-${t.bodyHtml.length}-${t.bodyHtml.slice(-48)}`}
                        title={`Preview: ${t.name}`}
                        className={PREVIEW_IFRAME_CLASS}
                        src={`/api/email-templates/preview?slug=${encodeURIComponent(t.slug)}`}
                      />
                    )}
                  </div>
                </div>

                {/* HTML source — only while editing; not the default focus */}
                {isEditing && (
                  <div className="lg:col-span-5 p-4 lg:p-5 bg-slate-50/50 border-t lg:border-t-0 border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">
                      Template fields
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor={`subject-${t.slug}`}
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Subject line
                        </label>
                        <input
                          id={`subject-${t.slug}`}
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`body-${t.slug}`}
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Message HTML
                        </label>
                        <p className="text-xs text-slate-500 mb-2">
                          This is the inner content only. The preview on the left shows the full email
                          customers get.
                        </p>
                        <textarea
                          id={`body-${t.slug}`}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          spellCheck={false}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono bg-white min-h-[min(50vh,420px)] resize-y"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
