#!/usr/bin/env node
/**
 * Run Prisma against the bike-catalog schema.
 * Falls back CATALOG_* URLs to DATABASE_URL / DIRECT_URL when unset.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const {
  loadDotEnv,
} = require("./db-url-diagnostics");

loadDotEnv();

if (!process.env.CATALOG_DATABASE_URL?.trim()) {
  process.env.CATALOG_DATABASE_URL = process.env.DATABASE_URL;
}
if (!process.env.CATALOG_DIRECT_URL?.trim()) {
  process.env.CATALOG_DIRECT_URL =
    process.env.DIRECT_URL || process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/catalog-prisma.js <prisma-args...>");
  process.exit(1);
}

const schema = path.join(__dirname, "..", "bike-catalog", "prisma", "schema.prisma");
const result = spawnSync(
  "npx",
  ["prisma", ...args, "--schema", schema],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" }
);
process.exit(result.status ?? 1);
