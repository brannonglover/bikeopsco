#!/usr/bin/env node
/**
 * Run Prisma CLI with DIRECT_URL falling back to DATABASE_URL when unset.
 * Schema validation requires both env vars; generate does not need a real DB.
 */
const { spawnSync } = require("child_process");
const {
  diagnosePair,
  formatReport,
  printFailureHelp,
} = require("./db-url-diagnostics");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/prisma.js <prisma-args...>");
  process.exit(1);
}

const command = args[0];
const needsDatabase = command === "migrate" || command === "db";

/** Supabase db.*.supabase.co is often IPv6-only and unreachable from Vercel builds. */
function validateSupabaseDirectUrl() {
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
    console.error(["Error: invalid DIRECT_URL for Prisma migrations.", "", ...issues].join("\n"));
    process.exit(1);
  }
}

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

if (needsDatabase && !process.env.DATABASE_URL) {
  console.error(
    [
      "Error: DATABASE_URL is not set.",
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
  validateSupabaseDirectUrl();
  runDbEnvValidation();
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
