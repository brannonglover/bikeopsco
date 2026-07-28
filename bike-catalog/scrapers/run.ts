#!/usr/bin/env npx ts-node
/**
 * Usage:
 *   npm run catalog:scrape -- specialized
 *   npm run catalog:scrape -- specialized --dry-run
 *   npm run catalog:scrape -- specialized --fixture bike-catalog/scrapers/fixtures/specialized-sample.json
 *   npm run catalog:scrape -- specialized --url https://www.specialized.com/...
 */
import { runSpecializedScrape } from "./specialized";
import { catalogPrisma } from "../lib/db";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  const brand = args.find((a) => !a.startsWith("--")) ?? "specialized";
  const dryRun = args.includes("--dry-run");
  const urls: string[] = [];
  let fixturePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      urls.push(args[i + 1]);
      i += 1;
    }
    if (args[i] === "--fixture" && args[i + 1]) {
      fixturePath = path.resolve(process.cwd(), args[i + 1]);
      i += 1;
    }
  }

  if (brand.toLowerCase() !== "specialized") {
    console.error(`Unknown scraper "${brand}". Available: specialized`);
    process.exit(1);
  }

  console.log(`Running Specialized scraper${dryRun ? " (dry run)" : ""}…`);
  const result = await runSpecializedScrape({
    urls: urls.length ? urls : undefined,
    fixturePath,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await catalogPrisma.$disconnect();
  });
