#!/usr/bin/env node
/**
 * Run Prisma CLI with DIRECT_URL falling back to DATABASE_URL when unset.
 * Schema validation requires both env vars; generate does not need a real DB.
 */
const { spawnSync } = require("child_process");
const {
  loadDotEnv,
  diagnosePair,
  formatReport,
  printFailureHelp,
} = require("./db-url-diagnostics");
const { checkPreviewDbIsolation } = require("./check-preview-db-isolation");

loadDotEnv();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/prisma.js <prisma-args...>");
  process.exit(1);
}

const command = args[0];
const needsDatabase = command === "migrate" || command === "db";

/** Append ?pgbouncer=true when transaction pooler URL omits it (common Vercel paste mistake). */
function normalizeDatabaseUrlPgbouncer() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return;

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.port !== "6543") return;
    if (parsed.searchParams.get("pgbouncer") === "true") return;
    parsed.searchParams.set("pgbouncer", "true");
    process.env.DATABASE_URL = parsed.toString();
  } catch {
    // diagnosePair will report invalid URL
  }
}

/** Append ?sslmode=require when Supabase Session URL omits it (common paste mistake). */
function normalizeDirectUrlSslMode() {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (!directUrl) return;

  try {
    const parsed = new URL(directUrl);
    if (parsed.searchParams.get("sslmode") === "require") return;
    parsed.searchParams.set("sslmode", "require");
    process.env.DIRECT_URL = parsed.toString();
  } catch {
    // diagnosePair will report invalid URL
  }
}

/** Supabase db.*.supabase.co is often IPv6-only and unreachable from Vercel builds. */
function validateSupabaseDirectUrl(directUrlWasUnset) {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (!directUrl) return;

  let parsed;
  try {
    parsed = new URL(directUrl);
  } catch {
    return;
  }

  const host = parsed.hostname;
  const issues = [];

  if (/^db\.[^.]+\.supabase\.co$/i.test(host)) {
    issues.push(
      `DIRECT_URL uses Supabase legacy direct host "${host}".`,
      "That hostname is often unreachable from Vercel (P1001). Use the pooler in Session mode instead:",
      "  postgresql://postgres.[project-ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require",
      "",
      "Supabase Dashboard → Project Settings → Database → Connection string → Session mode (port 5432).",
      "Do NOT copy the “Direct connection” URI (db.*.supabase.co).",
      "",
      "See DEPLOYMENT.md § Supabase connection strings."
    );
  }

  if (parsed.searchParams.get("pgbouncer") === "true") {
    issues.push(
      "DIRECT_URL must not use ?pgbouncer=true (transaction pooler).",
      "Use Session mode on port 5432 for migrations; keep ?pgbouncer=true on DATABASE_URL (port 6543) only."
    );
  }

  if (parsed.port === "6543") {
    issues.push(
      "DIRECT_URL uses port 6543 (transaction pooler). Migrations need Session mode on port 5432."
    );
  }

  if (issues.length > 0) {
    const preamble = directUrlWasUnset
      ? [
          "Error: DIRECT_URL is not set.",
          "",
          "Prisma copied DATABASE_URL for validation, but migrations need a separate Session pooler URL:",
          "  postgresql://postgres.[project-ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require",
          "",
          "Supabase Dashboard → Project Settings → Database → Connection string → Session mode (port 5432).",
          "In Vercel, set DIRECT_URL on Preview (develop) or Production — not Development only.",
          "",
        ]
      : ["Error: invalid DIRECT_URL for Prisma migrations.", ""];
    console.error([...preamble, ...issues].join("\n"));
    process.exit(1);
  }
}

const directUrlWasUnset = !process.env.DIRECT_URL?.trim();

// Mirror missing direct/pooled URLs so schema validation (P1012) passes.
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}
if (!process.env.DATABASE_URL && process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

// generate (postinstall) only emits the client — no connection required.
const PLACEHOLDER =
  "postgresql://build:build@127.0.0.1:5432/build?schema=public";
if (command === "generate" && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = PLACEHOLDER;
  process.env.DIRECT_URL = PLACEHOLDER;
}


if (needsDatabase && command === "migrate" && args[1] === "dev") {
  const host = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (/supabase\.com/i.test(host)) {
    console.warn(
      [
        "Note: Supabase does not support Prisma migrate dev (shadow DB → P3006).",
        "Use: npm run db:migrate  (migrate deploy) for staging/production Supabase.",
        "",
      ].join("\n")
    );
  }
}

if (needsDatabase && !process.env.DATABASE_URL?.trim()) {
  console.error(
    [
      "Error: DATABASE_URL is not set.",
      "",
      "Local: put DATABASE_URL and DIRECT_URL in .env.local (Preview/staging URLs).",
      "  `vercel env pull` often omits integration-managed DB URLs — do not rely on it alone.",
      "",
      "Vercel environment scopes (bikeopsco project):",
      "  • Preview — branch deploys (develop → dev.bikeops.co). NOT the same as “Development”.",
      "  • Production — main branch (app.bikeops.co).",
      "  • Development — local `vercel dev` only; ignored by Git push builds.",
      "",
      "Set DATABASE_URL (and DIRECT_URL for Supabase pooling) on Preview for staging,",
      "and on Production for production. Then redeploy.",
      "",
      "See DEPLOYMENT.md and docs/staging-environment.md.",
    ].join("\n")
  );
  process.exit(1);
}

if (needsDatabase) {
  normalizeDatabaseUrlPgbouncer();
  normalizeDirectUrlSslMode();
  validateSupabaseDirectUrl(directUrlWasUnset);
  runDbEnvValidation();
  if (command === "migrate" && args[1] === "deploy") {
    checkPreviewDbIsolation({ exitOnFailure: true });
  }
}

function runDbEnvValidation() {
  const diag = diagnosePair(process.env.DATABASE_URL, process.env.DIRECT_URL);
  const hasErrors =
    !diag.ok ||
    diag.pairIssues.length > 0 ||
    (diag.database.issues?.length ?? 0) > 0 ||
    (diag.direct.issues?.length ?? 0) > 0;

  if (!hasErrors) return;

  console.error(
    [
      "Error: DATABASE_URL / DIRECT_URL failed validation before Prisma.",
      "",
      formatReport(diag),
      printFailureHelp(),
    ].join("\n")
  );
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
