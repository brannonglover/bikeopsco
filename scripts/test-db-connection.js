#!/usr/bin/env node
/**
 * Test database connection (auth). Run: node scripts/test-db-connection.js
 * Uses DATABASE_URL and DIRECT_URL from .env / .env.local (no secrets printed).
 */
const { spawnSync } = require("child_process");
const { loadDotEnv } = require("./db-url-diagnostics");

loadDotEnv();

function redact(msg) {
  return String(msg).replace(/:([^:@/]+)@/g, ":****@");
}

function testUrl(label, url) {
  if (!url) {
    console.error(`❌ ${label} is not set`);
    return false;
  }
  const safe = url.replace(/:([^:@]+)@/, ":****@");
  console.log(`Testing ${label}: ${safe}`);

  const result = spawnSync(
    "npx",
    ["prisma", "db", "execute", "--url", url, "--stdin"],
    { input: "SELECT 1 as test;", encoding: "utf8" }
  );

  if (result.status === 0) {
    console.log(`✅ ${label} connection successful`);
    return true;
  }

  const err = redact(result.stderr || result.stdout || "");
  const code = err.match(/P100\d|P101\d/)?.[0] || "error";
  console.error(`❌ ${label} failed (${code})`);
  if (code === "P1000") {
    console.error("   Invalid database password or wrong Supabase project for this URL.");
  }
  return false;
}

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

if (!databaseUrl && !directUrl) {
  console.error("❌ DATABASE_URL and DIRECT_URL are not set.");
  console.error("   Run: npm run db:validate-env");
  process.exit(1);
}

const okDirect = testUrl("DIRECT_URL", directUrl);
const okDatabase = testUrl("DATABASE_URL", databaseUrl);

if (okDirect && okDatabase) {
  process.exit(0);
}

console.error("\nRun first: npm run db:validate-env");
console.error("\nCommon fixes:");
console.error("1. PAUSED PROJECT: Supabase free tier pauses after ~7 days.");
console.error("   → Dashboard → select project → Restore project");
console.error("2. Reset Database password: Supabase → Project Settings → Database");
console.error("   → paste new password into BOTH DATABASE_URL and DIRECT_URL (.env.local + Vercel)");
console.error("3. URL-encode special chars in password: @ → %40, # → %23, % → %25");
console.error("4. If you see circuit-breaker errors, wait ~15 minutes after fixing the password.");
process.exit(1);
