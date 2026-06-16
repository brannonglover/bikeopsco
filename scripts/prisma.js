#!/usr/bin/env node
/**
 * Run Prisma CLI with DIRECT_URL falling back to DATABASE_URL when unset.
 * Schema validation requires both env vars; generate does not need a real direct connection.
 */
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/prisma.js <prisma-args...>");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
