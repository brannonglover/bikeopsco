#!/usr/bin/env npx ts-node
/**
 * Usage:
 *   npm run catalog:scrape -- specialized
 *   npm run catalog:scrape -- trek
 *   npm run catalog:scrape -- schwinn
 *   npm run catalog:scrape -- trek --dry-run
 *   npm run catalog:scrape -- specialized --fixture path/to.json
 *   npm run catalog:scrape -- specialized --url https://www.specialized.com/...
 */
import { runSpecializedScrape } from "./specialized";
import { runTrekScrape } from "./trek";
import { runSchwinnScrape } from "./schwinn";
import { catalogPrisma } from "../lib/db";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  const brand = (args.find((a) => !a.startsWith("--")) ?? "specialized").toLowerCase();
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

  console.log(`Running ${brand} scraper${dryRun ? " (dry run)" : ""}…`);

  let result;
  if (brand === "specialized") {
    result = await runSpecializedScrape({
      urls: urls.length ? urls : undefined,
      fixturePath,
      dryRun,
    });
  } else if (brand === "trek") {
    result = await runTrekScrape({ fixturePath, dryRun });
  } else if (brand === "schwinn") {
    result = await runSchwinnScrape({ fixturePath, dryRun });
  } else {
    console.error(`Unknown scraper "${brand}". Available: specialized, trek, schwinn`);
    process.exit(1);
  }

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
