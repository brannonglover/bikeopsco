"use client";

import { useEffect } from "react";

function postHeight() {
  try {
    const height = document.documentElement?.scrollHeight ?? 0;
    window.parent?.postMessage?.({ type: "bikeops-widget-height", height }, "*");
  } catch {
    // noop
  }
}

export function AutoResize() {
  useEffect(() => {
    // Ensure layout has settled before measuring.
    const raf = window.requestAnimationFrame(() => postHeight());

    let ro: ResizeObserver | null = null;
    if (typeof window.ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => postHeight());
      ro.observe(document.documentElement);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return null;
}

