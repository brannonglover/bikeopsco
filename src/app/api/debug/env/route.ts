import { NextResponse } from "next/server";

/**
 * Debug endpoint to check which env vars the serverless function can see.
 * Does NOT expose secret values. Remove this file in production if desired.
 * GET /api/debug/env
 */
export async function GET() {
  const key = process.env.RESEND_API_KEY;
  const trimmed = key?.trim();

  return NextResponse.json({
    RESEND_API_KEY: {
      exists: typeof key === "string",
      hasValue: !!trimmed,
      length: key?.length ?? 0,
      startsWithRe: key?.startsWith("re_") ?? false,
      // Only show first 4 chars to help verify format (re_xxx) without leaking
      preview: key ? `${key.slice(0, 4)}...` : null,
    },
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "(not set)",
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
