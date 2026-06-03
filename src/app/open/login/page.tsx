"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function getTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return params.get("token");
}

function webChatUrlForToken(token: string | null): string {
  if (!token) return "/chat/c";
  return `/chat/c#token=${encodeURIComponent(token)}`;
}

export default function OpenLoginPage() {
  const [webChatUrl, setWebChatUrl] = useState("/chat/c");

  useEffect(() => {
    const token = getTokenFromHash();
    const chatUrl = webChatUrlForToken(token);
    setWebChatUrl(chatUrl);

    if (!token) {
      window.location.replace("/chat/c");
      return;
    }

    // Prefer native app when installed (Universal Link may open the app before this runs).
    window.location.href = `bikeops://login#token=${encodeURIComponent(token)}`;

    const fallbackTimer = window.setTimeout(() => {
      window.location.replace(chatUrl);
    }, 2500);

    return () => window.clearTimeout(fallbackTimer);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>Signing you in…</h1>
      <p style={{ color: "#64748b", textAlign: "center", maxWidth: 360, marginBottom: 24 }}>
        Opening the BikeOps app if it&apos;s installed. You can also continue in your browser to
        chat with your shop.
      </p>
      <Link
        href={webChatUrl}
        style={{
          color: "#4f46e5",
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Continue in browser
      </Link>
    </div>
  );
}
