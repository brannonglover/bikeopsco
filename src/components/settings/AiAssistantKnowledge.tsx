"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The service description the AI assistant quotes from.
 *
 * Importing from the website fills the editor but does not save — staff read
 * what came back and press save themselves. That one step is the whole reason
 * this isn't a background scrape: nothing the assistant can say to a customer
 * arrives without a person having seen it.
 */

type AiAssistantSettings = {
  websiteUrl: string | null;
  knowledge: string | null;
  knowledgeUpdatedAt: string | null;
};

const MAX_KNOWLEDGE_CHARS = 24_000;

export function AiAssistantKnowledge({ disabled }: { disabled?: boolean }) {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/ai-assistant", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as AiAssistantSettings;
      setWebsiteUrl(data.websiteUrl ?? "");
      setKnowledge(data.knowledge ?? "");
      setUpdatedAt(data.knowledgeUpdatedAt);
      setDirty(false);
    } catch {
      setError("Couldn't load the assistant's service description.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importFromWebsite = async () => {
    if (!websiteUrl.trim()) {
      setError("Enter your website address first.");
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/ai-assistant/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: websiteUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Import failed.");
        return;
      }
      setWebsiteUrl(data.websiteUrl);
      setKnowledge(data.knowledge);
      setDirty(true);
      const pageCount = Array.isArray(data.pages) ? data.pages.length : 1;
      setNotice(
        `Read ${pageCount} page${pageCount === 1 ? "" : "s"}. Check it over and trim anything the assistant shouldn't repeat, then save.`
      );
    } catch {
      setError("Import failed. Check the address and try again.");
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/ai-assistant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: websiteUrl.trim() || null,
          knowledge: knowledge.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to save.");
        return;
      }
      setUpdatedAt(data.knowledgeUpdatedAt);
      setDirty(false);
      setNotice("Saved.");
      window.setTimeout(() => setNotice(null), 2000);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || importing || saving || Boolean(disabled);

  return (
    <div className="space-y-3 rounded-lg border border-surface-border bg-surface-muted/40 p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">
          What the assistant can say you offer
        </p>
        <p className="mt-0.5 text-sm text-text-secondary">
          The assistant answers service and price questions from this text and
          nothing else. Import it from your website, then edit it freely — it is
          never re-imported on its own.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          value={websiteUrl}
          onChange={(e) => {
            setWebsiteUrl(e.target.value);
            setDirty(true);
          }}
          disabled={busy}
          placeholder="https://yourshop.com"
          aria-label="Shop website address"
          className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void importFromWebsite()}
          disabled={busy || !websiteUrl.trim()}
          className="flex-shrink-0 rounded-lg border border-surface-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? "Reading site…" : "Import from website"}
        </button>
      </div>

      <div>
        <textarea
          value={knowledge}
          onChange={(e) => {
            setKnowledge(e.target.value.slice(0, MAX_KNOWLEDGE_CHARS));
            setDirty(true);
          }}
          disabled={busy}
          rows={12}
          aria-label="Service description the assistant reads"
          placeholder={
            loading
              ? "Loading…"
              : "Describe the services you offer, what they cost, and anything the assistant should never promise."
          }
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-foreground disabled:opacity-50"
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
          <span>
            {knowledge.length.toLocaleString()} / {MAX_KNOWLEDGE_CHARS.toLocaleString()} characters
            {updatedAt
              ? ` · last saved ${new Date(updatedAt).toLocaleDateString()}`
              : ""}
          </span>
          {!knowledge.trim() && !loading && (
            <span className="text-amber-700 dark:text-amber-400">
              Empty — the assistant will collect details but won&apos;t describe
              your services or quote a price.
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !dirty}
        className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
          busy || !dirty
            ? "cursor-not-allowed bg-surface-border text-text-muted"
            : "bg-amber-600 text-white hover:bg-amber-700"
        }`}
      >
        {saving ? "Saving…" : "Save service description"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </div>
      )}
    </div>
  );
}
