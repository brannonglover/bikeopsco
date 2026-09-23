#!/usr/bin/env node
/**
 * Fail a Vercel Production build whose Supabase configuration cannot work.
 *
 * Both checks here come from a real outage: `SUPABASE_JWT_SECRET` on Production
 * held a different project's secret, so every staff browser was refused on
 * `realtime.messages` with `JwtSignatureError`. Nothing failed loudly — the job
 * board simply stopped updating live and fell back to foreground sync, which
 * looks like a quiet shop. It went unnoticed for days.
 *
 * Both are deliberately conservative: they only fail when the configuration is
 * *provably* wrong, and skip with a warning whenever the answer is unknowable
 * (var absent, non-legacy key format, unexpected algorithm). A build guard that
 * blocks deploys on a guess is worse than the bug it prevents.
 *
 * Checks, Production only:
 *
 *   1. SUPABASE_JWT_SECRET must verify NEXT_PUBLIC_SUPABASE_ANON_KEY. The anon
 *      key is itself an HS256 JWT signed with the project's secret, so this
 *      proves the two belong to the same project without any network call.
 *
 *   2. DATABASE_URL's project ref must equal PRODUCTION_SUPABASE_PROJECT_REF,
 *      when that is set on Production. This is the mirror of
 *      check-preview-db-isolation.js, which only asserts that Preview is *not*
 *      production and so leaves the opposite mix-up unguarded.
 *
 * Emergency bypass: SKIP_PRODUCTION_ENV_GUARD=true.
 *
 * Usage: npm run env:check-production
 */
const crypto = require("crypto");
const { diagnosePair } = require("./db-url-diagnostics");

function base64UrlDecode(segment) {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifies an HS256 compact JWT signature against `secret`.
 *
 * Returns `null` — not `false` — when the token is not a legacy HS256 JWT.
 * Newer `sb_publishable_` / `sb_secret_` keys are not JWTs at all, and a
 * project using asymmetric signing keys is not misconfigured just because this
 * check cannot read it.
 */
function verifyHs256(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
  } catch {
    return null;
  }
  if (header?.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  const actual = base64UrlDecode(parts[2]);

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function checkJwtSecret(failures, warnings) {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!secret || !anonKey) {
    warnings.push(
      "SUPABASE_JWT_SECRET or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set on Production — " +
        "skipping the Realtime signing check. Staff boards will fall back to foreground sync."
    );
    return;
  }

  const verified = verifyHs256(anonKey, secret);

  if (verified === null) {
    warnings.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not a legacy HS256 JWT — cannot verify that " +
        "SUPABASE_JWT_SECRET belongs to the same project. Skipping."
    );
    return;
  }

  if (!verified) {
    failures.push(
      [
        "SUPABASE_JWT_SECRET does not match the Supabase project that issued NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        "",
        "Every private Realtime subscription will be rejected with:",
        "  JwtSignatureError: Failed to validate JWT signature",
        "",
        "The staff job board and chat will still render — they fall back to foreground",
        "sync — so this does not look broken from the outside. It is.",
        "",
        "Fix:",
        "  1. Supabase dashboard → the *production* project → Project Settings → API",
        "     → JWT Settings → JWT Secret.",
        "  2. Vercel → bikeopsco → Settings → Environment Variables → SUPABASE_JWT_SECRET,",
        "     Production scope only. Watch for a trailing newline on the paste.",
        "  3. Redeploy.",
        "",
        "Most likely cause: the secret was copied from the staging project.",
      ].join("\n")
    );
  }
}

function checkDatabaseProject(failures, warnings) {
  const expectedRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!expectedRef) {
    warnings.push(
      "PRODUCTION_SUPABASE_PROJECT_REF is not set on Production — skipping the database " +
        "project check. Set it (the project ref is not secret) to catch a Production build " +
        "pointed at the staging database."
    );
    return;
  }
  if (!databaseUrl) {
    warnings.push("DATABASE_URL is not set — skipping the database project check.");
    return;
  }

  const actualRef = diagnosePair(databaseUrl, databaseUrl).database?.projectRef;
  if (!actualRef) {
    warnings.push(
      "Could not parse a Supabase project ref from DATABASE_URL (expected username " +
        "postgres.[project-ref]) — skipping the database project check."
    );
    return;
  }

  if (actualRef !== expectedRef) {
    failures.push(
      [
        "Production DATABASE_URL points at the wrong Supabase project.",
        `  expected ref: ${expectedRef}`,
        `  actual ref:   ${actualRef}`,
        "",
        "Migrations would run against that project, and production traffic would read",
        "and write its data.",
        "",
        "Fix: Vercel → bikeopsco → Settings → Environment Variables → DATABASE_URL and",
        "DIRECT_URL, Production scope. See DEPLOYMENT.md.",
      ].join("\n")
    );
  }
}

function checkProductionEnv(options = {}) {
  const { exitOnFailure = false } = options;

  if (process.env.VERCEL_ENV !== "production") {
    return { ok: true, skipped: true, reason: "not a Vercel Production build" };
  }

  if (process.env.SKIP_PRODUCTION_ENV_GUARD?.trim().toLowerCase() === "true") {
    console.warn("⚠ SKIP_PRODUCTION_ENV_GUARD=true — skipping production env checks.");
    return { ok: true, skipped: true, reason: "explicit bypass" };
  }

  const failures = [];
  const warnings = [];

  checkJwtSecret(failures, warnings);
  checkDatabaseProject(failures, warnings);

  for (const warning of warnings) {
    console.warn(`⚠ ${warning}`);
  }

  if (failures.length > 0) {
    const message = failures.join("\n\n");
    if (exitOnFailure) {
      console.error(`\nProduction environment check failed.\n\n${message}\n`);
      process.exit(1);
    }
    return { ok: false, failures };
  }

  console.log("✓ Production Supabase configuration checks passed.");
  return { ok: true };
}

if (require.main === module) {
  checkProductionEnv({ exitOnFailure: true });
}

module.exports = { checkProductionEnv, verifyHs256 };
