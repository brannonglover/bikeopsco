"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

export function BikeImageSearch({
  make,
  model,
  onSelect,
  disabled,
  onBusyChange,
  autoSearch = true,
  buttonClassName,
}: {
  make: string;
  model: string;
  onSelect: (url: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Auto-trigger search when both make and model are filled. Defaults to true. */
  autoSearch?: boolean;
  buttonClassName?: string;
}) {
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; thumbUrl: string; fullUrl: string; source?: string }>
  >([]);
  const [provider, setProvider] = useState<"serper" | "unsplash" | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasFields = make.trim() || model.trim();

  useEffect(() => {
    if (!showResults) {
      setSearchQuery([make.trim(), model.trim()].filter(Boolean).join(" "));
    }
  }, [make, model, showResults]);

  useEffect(() => {
    if (!autoSearch || !make.trim() || !model.trim() || showResults) return;
    const timer = setTimeout(() => {
      runSearch([make.trim(), model.trim()].filter(Boolean).join(" "));
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [make, model]);

  useEffect(() => {
    if (!showResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showResults]);

  useEffect(() => {
    if (showResults && !searching) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [showResults, searching]);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    setProvider(null);
    setShowResults(true);
    try {
      const params = new URLSearchParams({
        make: make.trim(),
        model: model.trim(),
        q: q.trim(),
      });
      const res = await fetch(`/api/bikes/search-image?${params}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.results)) {
        setResults(data.results);
        setProvider(data.provider ?? null);
        if (data.results.length === 0) {
          setError("No images found. Try refining your search or add a photo manually.");
        }
      } else {
        setError(data.error || "Search failed. Try adding a photo manually.");
      }
    } catch {
      setError("Search failed. Try adding a photo manually.");
    } finally {
      setSearching(false);
    }
  };

  const handlePick = async (fullUrl: string) => {
    setImporting(true);
    onBusyChange?.(true);
    try {
      const res = await fetch("/api/bikes/import-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        onSelect(data.url);
        setShowResults(false);
      } else {
        alert(data.error || "Could not save image");
      }
    } catch {
      alert("Could not save image");
    } finally {
      setImporting(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (showResults) {
            setShowResults(false);
          } else {
            runSearch(searchQuery || [make.trim(), model.trim()].filter(Boolean).join(" "));
          }
        }}
        disabled={disabled || !hasFields || searching}
        className={
          buttonClassName ??
          "text-xs text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        }
      >
        {searching ? "Searching..." : "Search for image online"}
      </button>
      {showResults && (
        <div className="absolute left-0 top-full mt-2 z-30 w-80 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden dark:border-slate-600 dark:bg-slate-800">
          <div className="flex items-center gap-1.5 p-2 border-b border-slate-100 dark:border-slate-700">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch(searchQuery);
                }
              }}
              placeholder="Refine search…"
              className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => runSearch(searchQuery)}
              disabled={searching || !searchQuery.trim()}
              className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {searching ? "…" : "Search"}
            </button>
            <button
              type="button"
              onClick={() => setShowResults(false)}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1 shrink-0"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="p-2">
            {searching ? (
              <p className="text-sm text-slate-500 py-4 text-center">Searching...</p>
            ) : error ? (
              <p className="text-sm text-slate-600 py-2 dark:text-slate-300">{error}</p>
            ) : results.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5 max-h-56 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handlePick(r.fullUrl)}
                    disabled={importing}
                    title={r.source}
                    className="relative aspect-square rounded overflow-hidden border-2 border-transparent hover:border-indigo-500 focus:border-indigo-500 transition-colors disabled:opacity-60"
                  >
                    <Image
                      src={r.thumbUrl}
                      alt=""
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {results.length > 0 && provider && (
              <p className="text-[10px] text-slate-400 mt-2">
                {provider === "serper" ? (
                  "Images from web search"
                ) : (
                  <>
                    Photos from{" "}
                    <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="underline">
                      Unsplash
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
