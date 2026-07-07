"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

function getTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return params.get("token");
}

async function verifyInBrowser(token: string): Promise<boolean> {
  const res = await fetch("/api/chat/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

export default function OpenLoginPage() {
  const verifiedRef = useRef(false);

  useEffect(() => {
    const token = getTokenFromHash();
    if (!token) {
      window.location.replace("/book");
      return;
    }

    // Prefer native app when installed (Universal Link may open the app before this runs).
    window.location.href = `bikeops://login#token=${encodeURIComponent(token)}`;

    const fallbackTimer = window.setTimeout(() => {
      void (async () => {
        if (verifiedRef.current) return;
        const ok = await verifyInBrowser(token);
        verifiedRef.current = true;
        if (ok) {
          window.history.replaceState(null, "", "/open/login");
          window.location.replace("/book");
          return;
        }
        window.location.replace(`/chat/c#token=${encodeURIComponent(token)}`);
      })();
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
        view your account.
      </p>
      <Link
        href="/book"
        onClick={(e) => {
          const token = getTokenFromHash();
          if (!token || verifiedRef.current) return;
          e.preventDefault();
          void (async () => {
            const ok = await verifyInBrowser(token);
            verifiedRef.current = true;
            window.history.replaceState(null, "", "/open/login");
            window.location.replace(ok ? "/book" : `/chat/c#token=${encodeURIComponent(token)}`);
          })();
        }}
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
