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

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/email-templates")
      .then((res) => res.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const startEdit = (t: EmailTemplate) => {
    setEditing(t.slug);
    setEditSubject(t.subject);
    setEditBody(t.bodyHtml);
  };

  const cancelEdit = () => {
    setEditing(null);
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
    <div className="w-full max-w-4xl min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold text-blue-900 mb-2">Email Templates</h1>
      <p className="text-slate-600 mb-6 break-words">
        Customize the emails sent to customers. Use variables:{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{customerName}}`}</code>
        ,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{bikeMake}}`}</code>
        ,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{bikeModel}}`}</code>
        ,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{shopName}}`}</code>
        ,{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{statusButtonHtml}}`}</code>
        {" "}(orange “Track status” button),{" "}
        <code className="bg-slate-100 px-1 rounded">{`{{statusUrl}}`}</code>
      </p>

      <div className="space-y-6">
        {templates.map((t) => (
          <div
            key={t.id}
            className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="font-semibold text-slate-900 min-w-0 truncate">{t.name}</h2>
              {editing !== t.slug ? (
                <button
                  onClick={() => startEdit(t)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-sm text-slate-600 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {editing === t.slug ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Subject
                  </label>
                  <input
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Body (HTML)
                  </label>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600 space-y-1">
                <p>
                  <span className="font-medium">Subject:</span> {t.subject}
                </p>
                <div className="mt-2 min-w-0">
                  <span className="font-medium">Body:</span>
                  <div
                    className="mt-1 p-2 bg-slate-50 rounded text-xs overflow-auto max-h-24 max-w-full"
                    dangerouslySetInnerHTML={{ __html: t.bodyHtml }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
