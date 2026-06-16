#!/usr/bin/env node
/**
 * Validates DATABASE_URL / DIRECT_URL for Supabase + Prisma (Vercel builds).
 * Reports connection shape only — never prints passwords or full URLs.
 *
 * Usage:
 *   node scripts/validate-db-env.js
 *   npm run db:validate-env
 */
"use strict";

const LABELS = ["DATABASE_URL", "DIRECT_URL"];

function redactUser(username) {
  if (!username) return "(missing)";
  if (username === "postgres") return "postgres ← WRONG (need postgres.[project-ref])";
  const dot = username.indexOf(".");
  if (dot === -1) return `${username} ← unexpected format`;
  return `postgres.[${username.slice(dot + 1).slice(0, 4)}…]`;
}

function parseDbUrl(raw, label) {
  const report = {
    label,
    set: false,
    issues: [],
    hints: [],
  };

  if (raw === undefined || raw === null || raw === "") {
    report.issues.push("not set");
    return report;
  }

  report.set = true;

  if (raw !== raw.trim()) {
    report.issues.push("has leading or trailing whitespace (common Vercel paste mistake)");
  }

  const url = raw.trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    report.issues.push("not a valid URL — check quoting and special characters in the password");
    return report;
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    report.issues.push(`protocol is ${parsed.protocol} (expected postgresql:)`);
  }

  const user = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const params = Object.fromEntries(parsed.searchParams);

  report.user = redactUser(user);
  report.host = host || "(missing)";
  report.port = port;
  report.passwordPresent = password.length > 0;
  report.queryParams = Object.keys(params);

  if (!password) {
    report.issues.push("password is empty");
  } else {
    if (password.startsWith("eyJ")) {
      report.issues.push(
        "password looks like a Supabase anon/service JWT — use Database password from Project Settings → Database"
      );
    }
    if (password.startsWith("sbp_")) {
      report.issues.push("password looks like a Supabase access token (sbp_) — not the database password");
    }
    if (/^sk_|^pk_|^re_|^whsec_/.test(password)) {
      report.issues.push("password looks like an API key (Stripe/Resend/etc.) — not the database password");
    }
    // Unencoded special chars in the raw userinfo often break parsing or auth.
    const userinfo = url.split("@")[0]?.split("://")[1] || "";
    if (/[@#%]/.test(userinfo) && !/%40|%23|%25/.test(userinfo)) {
      report.issues.push(
        "password may contain unencoded @ # or % — URL-encode (@ → %40, # → %23, % → %25)"
      );
    }
  }

  if (user === "postgres") {
    report.issues.push(
      'username is bare "postgres" — Supabase pooler requires postgres.[project-ref] (shown in Supabase connection string UI)'
    );
  } else if (!/^postgres\.[a-z0-9]+$/i.test(user)) {
    report.issues.push(`username "${user.split(".")[0]}…" is not postgres.[project-ref]`);
  }

  if (/^db\.[^.]+\.supabase\.co$/i.test(host)) {
    report.issues.push(
      `host ${host} is legacy direct connection — unreachable from Vercel (P1001). Use aws-0-[region].pooler.supabase.com`
    );
  }

  if (label === "DATABASE_URL") {
    if (!host.includes("pooler.supabase.com") && host.includes("supabase")) {
      report.hints.push("runtime URL should use the Transaction pooler host (pooler.supabase.com)");
    }
    if (port !== "6543") {
      report.issues.push(`port is ${port} — DATABASE_URL should use Transaction pooler port 6543`);
    }
    if (params.pgbouncer !== "true") {
      report.issues.push("missing ?pgbouncer=true (required for Transaction pooler / Prisma runtime)");
    }
    if (!params.sslmode) {
      report.hints.push("consider ?sslmode=require on DATABASE_URL");
    }
  }

  if (label === "DIRECT_URL") {
    if (port === "6543") {
      report.issues.push("port 6543 is Transaction pooler — DIRECT_URL must use Session pooler port 5432");
    }
    if (params.pgbouncer === "true") {
      report.issues.push("DIRECT_URL must not include ?pgbouncer=true (migrations use Session mode)");
    }
    if (!params.sslmode) {
      report.hints.push("consider ?sslmode=require on DIRECT_URL");
    }
  }

  report.projectRef = user.startsWith("postgres.") ? user.slice("postgres.".length) : null;
  return report;
}

function formatReport(report) {
  const lines = [
    `${report.label}:`,
    `  username: ${report.user ?? "(unparsed)"}`,
    `  host: ${report.host ?? "(unparsed)"}`,
    `  port: ${report.port ?? "(unparsed)"}`,
    `  password: ${report.passwordPresent ? "present" : "MISSING"}`,
  ];
  if (report.queryParams?.length) {
    lines.push(`  query: ${report.queryParams.join(", ")}`);
  }
  for (const issue of report.issues) {
    lines.push(`  ✗ ${issue}`);
  }
  for (const hint of report.hints || []) {
    lines.push(`  · ${hint}`);
  }
  return lines.join("\n");
}

function main() {
  const reports = LABELS.map((label) => parseDbUrl(process.env[label], label));
  const errors = [];
  const hints = [];

  for (const r of reports) {
    errors.push(...r.issues.map((i) => `${r.label}: ${i}`));
    hints.push(...(r.hints || []).map((h) => `${r.label}: ${h}`));
  }

  const refs = reports.map((r) => r.projectRef).filter(Boolean);
  if (refs.length === 2 && refs[0] !== refs[1]) {
    errors.push(
      "DATABASE_URL and DIRECT_URL use different Supabase project refs — both must be from the same project"
    );
  }

  const vercelEnv = process.env.VERCEL_ENV || "(local)";
  console.log(`Database env check (VERCEL_ENV=${vercelEnv})\n`);
  for (const r of reports) {
    console.log(formatReport(r));
    console.log("");
  }

  if (errors.length > 0) {
    console.error("Fix these before deploy:\n");
    for (const e of errors) {
      console.error(`  • ${e}`);
    }
    console.error(`
Supabase → Project Settings → Database → Connection string:
  • DATABASE_URL  = Transaction mode, port 6543, ?pgbouncer=true&sslmode=require
  • DIRECT_URL    = Session mode, port 5432, ?sslmode=require (no pgbouncer)
  • Username      = postgres.[project-ref] (copy from UI, not bare postgres)
  • Password      = Database password (Reset if unsure) — NOT anon key, NOT service_role key

Vercel → bikeopsco → Settings → Environment Variables:
  • develop / dev.bikeops.co → Preview (Git branch: develop) — NOT "Development"
  • main / app.bikeops.co    → Production
  • After edits: Redeploy (env vars do not apply to old deployments)

See DEPLOYMENT.md § Database connection fix checklist.
`);
    process.exit(1);
  }

  if (hints.length > 0) {
    console.log("Suggestions:\n");
    for (const h of hints) {
      console.log(`  · ${h}`);
    }
    console.log("");
  }

  console.log("✓ DATABASE_URL and DIRECT_URL structure look correct for Supabase + Prisma.");
  if (refs[0]) {
    console.log(`  project ref: ${refs[0].slice(0, 4)}… (both URLs match)`);
  }
  console.log(
    "\nIf migrate still fails with P1000 (auth failed), reset the database password in Supabase",
    "and paste the new password into Vercel (URL-encoded). P1001 = wrong host/port; P1012 = var missing."
  );
}

if (require.main === module) {
  main();
}

module.exports = { parseDbUrl, LABELS };
