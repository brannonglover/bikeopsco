"use client";

import { useCallback, useEffect, useState } from "react";
import { ListSkeleton } from "@/components/ui/Skeleton";

type ReleaseRow = {
  id: string;
  version: string;
  gitSha: string;
  title: string | null;
  bullets: string[];
  status: "draft" | "published" | "discarded";
  createdAt: string;
  publishedAt: string | null;
};

function statusLabel(status: ReleaseRow["status"]): string {
  if (status === "draft") return "Draft";
  if (status === "published") return "Published";
  return "Discarded";
}

function statusClass(status: ReleaseRow["status"]): string {
  if (status === "draft") return "bg-amber-50 text-amber-900 border-amber-200";
  if (status === "published") return "bg-emerald-50 text-emerald-900 border-emerald-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function AdminReleasesClient() {
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = releases.find((r) => r.id === selectedId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/releases", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as {
        releases?: ReleaseRow[];
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not load releases");
        setReleases([]);
        return;
      }
      const list = data?.releases ?? [];
      setReleases(list);
      setSelectedId((current) => {
        if (current && list.some((r) => r.id === current)) return current;
        return list.find((r) => r.status === "draft")?.id ?? list[0]?.id ?? null;
      });
    } catch {
      setError("Could not load releases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setTitle("");
      setBulletsText("");
      return;
    }
    setTitle(selected.title ?? "");
    setBulletsText(selected.bullets.join("\n"));
  }, [selected]);

  const save = async (status?: ReleaseRow["status"]) => {
    if (!selected) return;
    const bullets = bulletsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (bullets.length === 0) {
      setError("Add at least one bullet before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/releases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || null,
          bullets,
          ...(status ? { status } : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        release?: ReleaseRow;
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not save release");
        return;
      }
      if (data?.release) {
        setReleases((prev) => {
          const next = prev.map((r) => (r.id === data.release!.id ? data.release! : r));
          const statusRank: Record<ReleaseRow["status"], number> = {
            draft: 0,
            published: 1,
            discarded: 2,
          };
          const parse = (value: string) => {
            const parts = value.trim().split(".").map((part) => Number(part));
            return {
              y: parts[0] || 0,
              m: parts[1] || 0,
              d: parts[2] || 0,
              n: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3]! : 0,
            };
          };
          return [...next].sort((a, b) => {
            const rank = statusRank[a.status] - statusRank[b.status];
            if (rank !== 0) return rank;
            const left = parse(b.version);
            const right = parse(a.version);
            if (left.y !== right.y) return left.y - right.y;
            if (left.m !== right.m) return left.m - right.m;
            if (left.d !== right.d) return left.d - right.d;
            if (left.n !== right.n) return left.n - right.n;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
        });
      } else {
        await load();
      }
    } catch {
      setError("Could not save release");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Releases</h2>
          <p className="mt-0.5 text-xs text-slate-500">Drafts first, newest version first</p>
        </div>
        {loading ? (
          <div className="p-2">
            <ListSkeleton rows={6} withAvatar={false} label="Loading releases" />
          </div>
        ) : releases.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            No drafts yet. Merge to <code className="text-xs">main</code> to generate one.
          </p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-auto">
            {releases.map((release) => (
              <li key={release.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(release.id)}
                  className={`block w-full px-4 py-3 text-left transition-colors ${
                    selectedId === release.id ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{release.version}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(
                        release.status
                      )}`}
                    >
                      {statusLabel(release.status)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {release.title || release.bullets[0] || release.gitSha.slice(0, 7)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {!selected ? (
          <p className="text-sm text-slate-500">Select a release to edit.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Version</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.version}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500">{selected.gitSha}</p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(
                  selected.status
                )}`}
              >
                {statusLabel(selected.status)}
              </span>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <label className="mt-5 block">
              <span className="text-sm font-medium text-slate-700">Title (optional)</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="Short headline for this release"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Bullets (one per line)</span>
              <textarea
                value={bulletsText}
                onChange={(event) => setBulletsText(event.target.value)}
                rows={12}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[13px] leading-6 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder={"Added …\nImproved …\nFixed …"}
              />
            </label>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Preview (how it will look when published)
              </p>
              {bulletsText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean).length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Add one update per line above.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-800">
                  {bulletsText
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((bullet, index) => (
                      <li key={`${index}-${bullet.slice(0, 24)}`}>{bullet}</li>
                    ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              {selected.status !== "published" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save("published")}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Publish
                </button>
              )}
              {selected.status === "published" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save("published")}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Save & keep published
                </button>
              )}
              {selected.status !== "discarded" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save("discarded")}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Discard
                </button>
              )}
              {selected.status === "discarded" && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save("draft")}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  Restore to draft
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
