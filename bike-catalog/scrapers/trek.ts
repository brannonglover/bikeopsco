import { runBrandFixtureScrape } from "./brand-fixture";

export function runTrekScrape(options: { fixturePath?: string; dryRun?: boolean } = {}) {
  return runBrandFixtureScrape({
    brandName: "Trek",
    brandSlug: "trek",
    brandAliases: ["Trek Bicycle"],
    scraperKey: "trek",
    defaultFixtureFile: "trek-sample.json",
    fixturePath: options.fixturePath,
    dryRun: options.dryRun,
  });
}
