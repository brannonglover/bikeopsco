import { runBrandFixtureScrape } from "./brand-fixture";

export function runSchwinnScrape(options: { fixturePath?: string; dryRun?: boolean } = {}) {
  return runBrandFixtureScrape({
    brandName: "Schwinn",
    brandSlug: "schwinn",
    brandAliases: ["Schwinn Bicycle"],
    scraperKey: "schwinn",
    defaultFixtureFile: "schwinn-sample.json",
    fixturePath: options.fixturePath,
    dryRun: options.dryRun,
  });
}
