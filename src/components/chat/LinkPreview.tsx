"use client";

import { useEffect, useState } from "react";

type OgData = {
  imageUrl: string | null;
  title: string | null;
};

type LinkPreviewProps = {
  url: string;
};

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<OgData | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setData(null);
    setImgError(false);
    const controller = new AbortController();
    fetch(`/api/og-preview?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: OgData) => {
        if (d.imageUrl || d.title) setData(d);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);

  if (!data) return null;

  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  if (!data.imageUrl || imgError) {
    if (!data.title) return null;

    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-opacity hover:opacity-90"
      >
        <div className="px-3 py-2">
          {hostname ? (
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              {hostname}
            </div>
          ) : null}
          <div className="truncate text-xs font-medium text-slate-700">
            {data.title}
          </div>
        </div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-opacity hover:opacity-90"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.imageUrl}
        alt={data.title ?? "Link preview"}
        className="max-h-64 w-full object-cover"
        onError={() => setImgError(true)}
      />
      {data.title && (
        <div className="truncate px-3 py-1.5 text-xs font-medium text-slate-700">
          {data.title}
        </div>
      )}
    </a>
  );
}
