"use client";

import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "@/components/QueryProvider";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
