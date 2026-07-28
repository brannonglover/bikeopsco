#!/usr/bin/env node
/**
 * Run a bike-catalog TypeScript entrypoint with env loaded
 * and CATALOG_* URLs falling back to DATABASE_URL.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const { loadDotEnv } = require("./db-url-diagnostics");

loadDotEnv();

if (!process.env.CATALOG_DATABASE_URL?.trim()) {
  process.env.CATALOG_DATABASE_URL = process.env.DATABASE_URL;
}
if (!process.env.CATALOG_DIRECT_URL?.trim()) {
  process.env.CATALOG_DIRECT_URL =
    process.env.DIRECT_URL || process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL;
}

const entry = process.argv[2];
if (!entry) {
  console.error("Usage: node scripts/run-catalog-ts.js <relative-ts-file> [...args]");
  process.exit(1);
}

const file = path.resolve(__dirname, "..", entry);
const extraArgs = process.argv.slice(3);
const result = spawnSync(
  "npx",
  [
    "ts-node",
    "--compiler-options",
    '{"module":"commonjs","moduleResolution":"node"}',
    file,
    ...extraArgs,
  ],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" }
);
process.exit(result.status ?? 1);
