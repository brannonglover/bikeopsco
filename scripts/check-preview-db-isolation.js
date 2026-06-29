#!/usr/bin/env node
/**
 * Block Vercel Preview builds that point DATABASE_URL at the production Supabase project.
 *
 * Set PRODUCTION_SUPABASE_PROJECT_REF on Preview (develop) — project ref is not secret.
 * Optional emergency bypass: SKIP_PREVIEW_DB_ISOLATION=true on Preview only.
 *
 * Usage: npm run db:check-isolation
 */
const { diagnosePair } = require("./db-url-diagnostics");

function checkPreviewDbIsolation(options = {}) {
  const { exitOnFailure = false } = options;

  if (process.env.VERCEL_ENV !== "preview") {
    return { ok: true, skipped: true, reason: "not a Vercel Preview build" };
  }

  if (process.env.SKIP_PREVIEW_DB_ISOLATION?.trim().toLowerCase() === "true") {
    console.warn(
      "⚠ SKIP_PREVIEW_DB_ISOLATION=true — skipping preview/production DB isolation check."
    );
    return { ok: true, skipped: true, reason: "explicit bypass" };
  }

  const forbiddenRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  if (!forbiddenRef) {
    console.warn(
      "⚠ PRODUCTION_SUPABASE_PROJECT_REF is not set on Preview — cannot verify staging DB isolation."
    );
    return { ok: true, skipped: true, reason: "PRODUCTION_SUPABASE_PROJECT_REF not set" };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { ok: true, skipped: true, reason: "DATABASE_URL not set" };
  }

  const diag = diagnosePair(databaseUrl, databaseUrl);
  const previewRef = diag.database?.projectRef;
  const previewHost = diag.database?.host ?? null;

  if (!previewRef) {
    const message =
      "Could not parse Supabase project ref from DATABASE_URL (expected username postgres.[project-ref]).";
    if (exitOnFailure) {
      console.error(`Error: ${message}`);
      process.exit(1);
    }
    return { ok: false, error: message };
  }

  if (previewRef === forbiddenRef) {
    const message = [
      "Preview DATABASE_URL points at the production Supabase project.",
      `  production ref: ${forbiddenRef}`,
      `  preview ref:    ${previewRef}`,
      previewHost ? `  preview host:   ${previewHost}` : null,
      "",
      "Fix:",
      "  1. Create a new Supabase project for staging (empty — do not clone production).",
      "  2. Vercel → bikeopsco → Settings → Environment Variables:",
      "     Update Preview (develop) DATABASE_URL + DIRECT_URL only.",
      "  3. npm run db:migrate && npm run db:seed:staging against the staging URLs.",
      "  4. Redeploy develop.",
      "",
      "See docs/staging-environment.md and DEPLOYMENT.md.",
    ]
      .filter(Boolean)
      .join("\n");

    if (exitOnFailure) {
      console.error(message);
      process.exit(1);
    }
    return { ok: false, error: message, previewRef, forbiddenRef, previewHost };
  }

  console.log(
    `✓ Preview DATABASE_URL uses staging Supabase project ref ${previewRef} (not production ${forbiddenRef}).`
  );
  return { ok: true, previewRef, forbiddenRef, previewHost };
}

if (require.main === module) {
  checkPreviewDbIsolation({ exitOnFailure: true });
}

module.exports = { checkPreviewDbIsolation };
