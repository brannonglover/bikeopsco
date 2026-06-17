/**
 * Safe DATABASE_URL / DIRECT_URL diagnostics — never prints passwords or full URLs.
 */

function parseEnvLine(line) {
  const m = line.match(/^(DATABASE_URL|DIRECT_URL)=(.*)$/);
  if (!m) return null;
  let val = m[2].trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return { key: m[1], val };
}

/** Load DATABASE_URL / DIRECT_URL from .env then .env.local (Next.js order). */
function loadDotEnv() {
  try {
    const fs = require("fs");
    const path = require("path");
    const cwd = process.cwd();
    const shellDatabase = process.env.DATABASE_URL?.trim();
    const shellDirect = process.env.DIRECT_URL?.trim();

    for (const name of [".env", ".env.local"]) {
      const envPath = path.join(cwd, name);
      if (!fs.existsSync(envPath)) continue;
      fs.readFileSync(envPath, "utf8")
        .split("\n")
        .forEach((line) => {
          const parsed = parseEnvLine(line);
          if (!parsed) return;
          const val = parsed.val?.trim();
          if (!val) return;
          if (parsed.key === "DATABASE_URL" && shellDatabase) return;
          if (parsed.key === "DIRECT_URL" && shellDirect) return;
          process.env[parsed.key] = val;
        });
    }
  } catch {
    // ignore
  }
}

function extractProjectRef(username) {
  if (!username || !username.includes(".")) return null;
  const parts = username.split(".");
  if (parts[0] !== "postgres" || !parts[1]) return null;
  return parts.slice(1).join(".");
}

function parseDbUrl(raw, label) {
  const issues = [];
  const warnings = [];

  if (raw == null || raw === "") {
    return { label, ok: false, issues: ["not set"], warnings };
  }

  const hasLeadingWs = /^\s/.test(raw);
  const hasTrailingWs = /\s$/.test(raw);
  const hasEmbeddedNewline = /[\r\n]/.test(raw);
  if (hasLeadingWs || hasTrailingWs) {
    issues.push("has leading/trailing whitespace (common Vercel paste mistake)");
  }
  if (hasEmbeddedNewline) {
    issues.push("contains a newline character");
  }

  const trimmed = raw.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      label,
      ok: false,
      issues: ["invalid URL — check quotes, spaces, and special characters in password"],
      warnings,
    };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    issues.push(`unexpected protocol ${parsed.protocol} (expected postgresql:)`);
  }

  const username = decodeURIComponent(parsed.username || "");
  const password = parsed.password || "";
  const decodedPassword = (() => {
    try {
      return decodeURIComponent(password);
    } catch {
      issues.push("password is not valid URL-encoding");
      return password;
    }
  })();

  const projectRef = extractProjectRef(username);
  const host = parsed.hostname;
  const port = parsed.port || "5432";

  if (username === "postgres") {
    issues.push(
      'username is "postgres" — Supabase pooler requires postgres.[project-ref]'
    );
  } else if (!/^postgres\.[a-z0-9]+$/i.test(username)) {
    warnings.push(`username "${username}" does not match postgres.[project-ref]`);
  }

  if (!password) {
    issues.push("password is missing from URL");
  } else {
    if (password.startsWith("eyJ") || decodedPassword.startsWith("eyJ")) {
      issues.push(
        "password looks like a JWT (anon/service_role key) — use Database password from Supabase"
      );
    }
    if (/^sb_[a-z]+_/.test(decodedPassword)) {
      issues.push("password looks like a Supabase API key, not the database password");
    }
    if (decodedPassword.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(decodedPassword)) {
      warnings.push(
        "password looks like a long API token — confirm it is the Database password"
      );
    }
    if (/[@#%]/.test(decodedPassword) && decodedPassword === password) {
      issues.push(
        "password contains @ # or % but is not URL-encoded (@ → %40, # → %23, % → %25)"
      );
    }
  }

  if (/^db\.[^.]+\.supabase\.co$/i.test(host)) {
    issues.push(
      `host ${host} is legacy direct connection — use aws-0-[region].pooler.supabase.com`
    );
  }

  const pgbouncer = parsed.searchParams.get("pgbouncer");
  const sslmode = parsed.searchParams.get("sslmode");

  return {
    label,
    ok: issues.length === 0,
    issues,
    warnings,
    username,
    projectRef,
    host,
    port,
    pgbouncer,
    sslmode,
    passwordLength: password.length,
    hasWhitespace: hasLeadingWs || hasTrailingWs || hasEmbeddedNewline,
  };
}

function diagnosePair(databaseUrl, directUrl) {
  const database = parseDbUrl(databaseUrl, "DATABASE_URL");
  const direct = parseDbUrl(directUrl, "DIRECT_URL");

  const pairIssues = [];
  const pairWarnings = [];

  if (database.projectRef && direct.projectRef && database.projectRef !== direct.projectRef) {
    pairIssues.push(
      `project ref mismatch: DATABASE_URL=${database.projectRef}, DIRECT_URL=${direct.projectRef} (must be same Supabase project)`
    );
  }

  if (database.host && direct.host && database.host !== direct.host) {
    pairWarnings.push(
      `hosts differ (${database.host} vs ${direct.host}) — usually OK if both are pooler URLs`
    );
  }

  if (database.passwordLength && direct.passwordLength && database.passwordLength !== direct.passwordLength) {
    pairWarnings.push("password lengths differ between DATABASE_URL and DIRECT_URL");
  }

  // DATABASE_URL expectations (transaction pooler)
  if (database.port && database.port !== "6543") {
    pairWarnings.push(`DATABASE_URL port is ${database.port} (expected 6543 for transaction pooler)`);
  }
  if (database.port === "6543" && database.pgbouncer !== "true") {
    pairIssues.push(
      "DATABASE_URL missing ?pgbouncer=true (required for transaction pooler on 6543 — causes prepared statement 500s)"
    );
  }

  // DIRECT_URL expectations (session pooler for migrations)
  if (direct.pgbouncer === "true") {
    pairIssues.push("DIRECT_URL must not use ?pgbouncer=true — use Session mode on port 5432");
  }
  if (direct.port === "6543") {
    pairIssues.push("DIRECT_URL uses port 6543 — migrations need Session mode on port 5432");
  }
  if (direct.port && direct.port !== "5432") {
    pairWarnings.push(`DIRECT_URL port is ${direct.port} (expected 5432 for session pooler)`);
  }
  if (direct.sslmode !== "require") {
    pairWarnings.push('DIRECT_URL missing ?sslmode=require');
  }

  const ok =
    database.ok &&
    direct.ok &&
    pairIssues.length === 0 &&
    database.issues.length === 0 &&
    direct.issues.length === 0;

  return { database, direct, pairIssues, pairWarnings, ok };
}

function formatReport(result) {
  const lines = [];
  const { database, direct, pairIssues, pairWarnings } = result;

  for (const entry of [database, direct]) {
    lines.push(`── ${entry.label} ──`);
    if (entry.issues?.includes("not set")) {
      lines.push("  ✗ not set");
      continue;
    }
    if (entry.issues?.[0]?.startsWith("invalid URL")) {
      lines.push(`  ✗ ${entry.issues[0]}`);
      continue;
    }
    lines.push(`  username:     ${entry.username ?? "(parse failed)"}`);
    lines.push(`  project ref:  ${entry.projectRef ?? "(none — check username)"}`);
    lines.push(`  host:         ${entry.host ?? "?"}`);
    lines.push(`  port:         ${entry.port ?? "?"}`);
    lines.push(`  pgbouncer:    ${entry.pgbouncer ?? "(not set)"}`);
    lines.push(`  sslmode:      ${entry.sslmode ?? "(not set)"}`);
    lines.push(`  password:     ${entry.passwordLength ? `present (${entry.passwordLength} chars)` : "MISSING"}`);
    for (const issue of entry.issues || []) {
      if (!issue.startsWith("username") && !issue.startsWith("password is missing")) {
        lines.push(`  ✗ ${issue}`);
      } else if (issue.startsWith("username") || issue === "password is missing from URL") {
        lines.push(`  ✗ ${issue}`);
      }
    }
    for (const w of entry.warnings || []) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push("");
  }

  if (pairIssues.length) {
    lines.push("── cross-check ──");
    for (const issue of pairIssues) lines.push(`  ✗ ${issue}`);
    lines.push("");
  }
  for (const w of pairWarnings) {
    lines.push(`  ⚠ ${w}`);
  }

  return lines.join("\n");
}

function printFailureHelp() {
  return [
    "",
    "If username is already postgres.[project-ref], check these next (in order):",
    "  1. Password — Supabase → Project Settings → Database → Database password (not anon/service key)",
    "  2. URL-encode special chars in password: @ → %40, # → %23, % → %25",
    "  3. DATABASE_URL and DIRECT_URL must be from the SAME Supabase project (same ref in username)",
    "  4. Vercel scope — Preview (develop) for staging, Production for main; then Redeploy",
    "  5. After resetting DB password in Supabase, update BOTH URLs in Vercel (no trailing newline)",
    "",
    "Run: npm run db:validate-env",
    "See: DEPLOYMENT.md § Supabase connection strings",
  ].join("\n");
}

module.exports = {
  loadDotEnv,
  diagnosePair,
  formatReport,
  printFailureHelp,
};
