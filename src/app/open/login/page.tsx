"use client";

import { useEffect } from "react";

export default function OpenLoginPage() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const token = params.get("token");

    if (token) {
      window.location.href = `bikeops://login#token=${encodeURIComponent(token)}`;
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>Opening BikeOps...</h1>
      <p style={{ color: "#64748b", textAlign: "center", maxWidth: 320 }}>
        If the app doesn&apos;t open automatically, make sure you have BikeOps installed on your device.
      </p>
    </div>
  );
}
