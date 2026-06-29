const { defineConfig } = require("prisma/config");
const { loadDotEnv } = require("./scripts/db-url-diagnostics");

// Next.js keeps DB URLs in .env.local; Prisma only auto-loads .env.
loadDotEnv();

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}
if (!process.env.DATABASE_URL && process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
});
