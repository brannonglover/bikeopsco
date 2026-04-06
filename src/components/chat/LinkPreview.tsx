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
        if (d.imageUrl) setData(d);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);

  if (!data || !data.imageUrl || imgError) return null;

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
