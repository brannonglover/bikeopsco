#!/usr/bin/env node
/**
 * Safe DATABASE_URL / DIRECT_URL validation. Never prints secrets.
 * Usage: npm run db:validate-env
 *        DATABASE_URL=... DIRECT_URL=... npm run db:validate-env
 */
const {
  loadDotEnv,
  diagnosePair,
  formatReport,
  printFailureHelp,
} = require("./db-url-diagnostics");

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

console.log("Database URL diagnostics (no secrets printed)\n");
console.log(formatReport(diagnosePair(databaseUrl, directUrl)));

const result = diagnosePair(databaseUrl, directUrl);
const hasErrors =
  !result.ok ||
  result.pairIssues.length > 0 ||
  result.database.issues?.length > 0 ||
  result.direct.issues?.length > 0;

if (hasErrors) {
  console.log(printFailureHelp());
  process.exit(1);
}

console.log("\n✓ DATABASE_URL and DIRECT_URL look correctly structured.");
console.log("  Next: redeploy on Vercel, or run: node scripts/test-db-connection.js");
