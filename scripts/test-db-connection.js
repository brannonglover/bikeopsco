#!/usr/bin/env node
/**
 * Test database connection. Run: node scripts/test-db-connection.js
 * Helps diagnose Supabase connection issues.
 */
const fs = require("fs");
const path = require("path");
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^DATABASE_URL=(.+)$/);
    if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
  });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL not set in .env");
  process.exit(1);
}

// Hide password in output
const safeUrl = url.replace(/:([^:@]+)@/, ":****@");
console.log("Testing connection to:", safeUrl);

const { execSync } = require("child_process");
try {
  execSync("npx prisma db execute --stdin", {
    input: "SELECT 1 as test;",
    encoding: "utf8",
  });
  console.log("✅ Connection successful!");
} catch (err) {
  console.error("❌ Connection failed.");
  console.error("\nCommon fixes:");
  console.error("1. PAUSED PROJECT: Supabase free tier pauses after ~7 days.");
  console.error("   → Dashboard: https://supabase.com/dashboard → select project → 'Restore project'");
  console.error("2. Try the SESSION POOLER connection (port 6543) from Supabase Dashboard");
  console.error("   → Project Settings → Database → Connection string → Session mode");
  console.error("3. Ensure password has no unencoded special chars: @ → %40, # → %23, etc.");
  process.exit(1);
}
