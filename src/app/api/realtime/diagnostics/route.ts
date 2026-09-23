import { NextRequest, NextResponse } from "next/server";
import { compactVerify } from "jose";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { chatChannelName } from "@/lib/realtime/chat-events";
import { jobChannelName } from "@/lib/realtime/job-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/realtime/diagnostics — why a private channel will or will not join.
 *
 * A `CHANNEL_ERROR` on subscribe has only a handful of causes, and from the
 * browser they are indistinguishable. The common one is a configuration split:
 * migrations run against the project in `DATABASE_URL`, so the RLS policy
 * lands there, while the browser connects to whatever `NEXT_PUBLIC_SUPABASE_URL`
 * names. Point those at different projects and every private subscription is
 * rejected by a project that has no policy, with everything else looking fine.
 *
 * This reports the project ref each setting resolves to, so a mismatch is
 * obvious, plus whether the signing secret is present. Staff-only, and it
 * returns refs and booleans — never a key, a secret, or a connection string.
 * Project refs are not secrets: they are in the public Supabase URL already.
 */

/** `postgres.<ref>` is how Supabase names the pooler user. */
function refFromDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const user = decodeURIComponent(new URL(url).username);
    const match = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (match) return match[1];
    // Direct (non-pooler) connections carry the ref in the host instead.
    const host = new URL(url).hostname.match(/^db\.([a-z0-9]+)\.supabase\./i);
    return host ? host[1] : null;
  } catch {
    return null;
  }
}

function refFromSupabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.match(/^([a-z0-9]+)\.supabase\./i)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Legacy Supabase keys are unsigned-payload JWTs carrying `ref`. Newer
 * `sb_publishable_` / `sb_secret_` keys are not, so this returns null for them
 * rather than pretending to know.
 */
function refFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

/**
 * Does `SUPABASE_JWT_SECRET` actually match the project's signing secret?
 *
 * The legacy anon key is itself a JWT signed with that secret, so verifying it
 * locally answers the question outright — no network call, and nothing secret
 * leaves the function. `compactVerify` checks the signature only: an anon key
 * that is past its expiry still proves the secret is right.
 *
 * Returns null when the answer is unknowable: newer `sb_publishable_` keys are
 * not JWTs, so there is nothing to verify against.
 */
async function jwtSecretValidatesAnonKey(): Promise<boolean | null> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!anonKey || !secret) return null;
  if (anonKey.split(".").length !== 3) return null;

  try {
    await compactVerify(anonKey, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

/**
 * Is the `realtime.messages` policy actually present in the database this
 * deployment is connected to?
 *
 * Migrations only reach the project named by `DATABASE_URL`. If that is a
 * different Supabase project from the one the browser connects to, the policy
 * can be perfectly correct in one project and entirely absent from the other —
 * which reads as `Unauthorized: You do not have permissions to read from this
 * Channel topic` rather than a signature error. Checking it from inside the
 * deployment removes the guesswork about which database was inspected.
 */
async function realtimePolicyState(): Promise<{
  rlsEnabled: boolean | null;
  policyNames: string[] | null;
  error: string | null;
}> {
  try {
    const rls = await prisma.$queryRaw<{ enabled: boolean | null }[]>`
      SELECT relrowsecurity AS enabled
      FROM pg_class
      WHERE oid = to_regclass('realtime.messages')
    `;
    const policies = await prisma.$queryRaw<{ policyname: string }[]>`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'realtime' AND tablename = 'messages'
    `;
    return {
      rlsEnabled: rls[0]?.enabled ?? null,
      policyNames: policies.map((p) => p.policyname),
      error: null,
    };
  } catch (e) {
    return {
      rlsEnabled: null,
      policyNames: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  const refs = {
    fromSupabaseUrl: refFromSupabaseUrl(),
    fromAnonKey: refFromKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    fromServiceRoleKey: refFromKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
    fromDatabaseUrl: refFromDatabaseUrl(),
  };

  const known = Object.values(refs).filter((r): r is string => r !== null);
  const distinct = [...new Set(known)];

  return NextResponse.json(
    {
      vercelEnv: process.env.VERCEL_ENV ?? "(not set)",
      shopId: auth.shopId,
      topics: {
        jobs: jobChannelName(auth.shopId),
        chat: chatChannelName(auth.shopId),
      },
      projectRefs: refs,
      // The check that matters: the browser's project must be the one the
      // migrations (and therefore the realtime.messages policy) ran against.
      projectRefsAgree: distinct.length <= 1,
      distinctProjectRefs: distinct,
      configured: {
        supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        anonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        // Length only — enough to spot a truncated paste, useless to an attacker.
        jwtSecret: Boolean(jwtSecret),
        // Supabase's legacy JWT secret is 40 characters. A wildly different
        // length usually means an anon/service key was pasted in by mistake.
        jwtSecretLength: jwtSecret?.length ?? 0,
      },
      // false here is the whole answer: the secret this app signs Realtime
      // tokens with is not the one the project verifies them against, which
      // surfaces in the browser as "JwtSignatureError". null means the key is
      // not a legacy JWT, so the check could not run.
      jwtSecretValidatesAnonKey: await jwtSecretValidatesAnonKey(),
      // Reported for the database this deployment actually talks to, which is
      // not necessarily the project the browser subscribes against.
      realtimePolicy: await realtimePolicyState(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
