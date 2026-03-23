import { NextResponse } from "next/server";
import { getAppUrl, getResendApiKey } from "@/lib/env";

/**
 * Debug endpoint to check which env vars the serverless function can see.
 * Does NOT expose secret values. Remove this file in production if desired.
 * GET /api/debug/env
 */
export async function GET() {
  const key = process.env.RESEND_API_KEY;
  const altKey = process.env.BIKEOPS_RESEND_API_KEY;
  const trimmed = key?.trim();
  const altTrimmed = altKey?.trim();

  // List all env var names that exist (no values) to spot which work
  const allKeys = Object.keys(process.env).sort();
  const customKeys = allKeys.filter(
    (k) =>
      !k.startsWith("npm_") &&
      !k.startsWith("NODE_") &&
      k !== "PATH" &&
      k !== "PWD" &&
      k !== "HOME"
  );

  const resolvedKey = getResendApiKey();
  const resolvedUrl = getAppUrl();

  return NextResponse.json({
    RESEND_API_KEY: {
      exists: typeof key === "string",
      hasValue: !!trimmed,
      length: key?.length ?? 0,
      preview: key ? `${key.slice(0, 4)}...` : null,
    },
    BIKEOPS_RESEND_API_KEY: {
      exists: typeof altKey === "string",
      hasValue: !!altTrimmed,
      length: altKey?.length ?? 0,
      preview: altKey ? `${altKey.slice(0, 4)}...` : null,
    },
    resolvedResendKey: !!resolvedKey,
    resolvedAppUrl: resolvedUrl || "(empty)",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "(not set)",
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL || "(not set)",
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL || "(not set)",
    envKeysAvailable: customKeys,
  });
}
