import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCatalogMatches, normalizeModelName, type CatalogBikeWithRelations } from "./match";

let seq = 0;
function row(
  model: string,
  opts: {
    brand?: string;
    aliases?: string[];
    yearStart?: number | null;
    yearEnd?: number | null;
    specStatus?: "APPROXIMATE" | "SOURCED" | "VERIFIED";
    family?: string | null;
  } = {}
): CatalogBikeWithRelations {
  seq += 1;
  const brandName = opts.brand ?? "Trek";
  const yearStart = opts.yearStart === undefined ? 2021 : opts.yearStart;
  return {
    id: `bike-${seq}`,
    brandId: `brand-${brandName}`,
    brand: {
      id: `brand-${brandName}`,
      name: brandName,
      slug: brandName.toLowerCase(),
      scraperKey: null,
      aliases: opts.aliases ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    model,
    family: opts.family ?? null,
    yearStart,
    yearEnd: opts.yearEnd === undefined ? yearStart : opts.yearEnd,
    category: null,
    subcategory: null,
    sourceUrl: null,
    thumbnailUrl: null,
    externalKey: `key-${seq}`,
    confidence: 0.8,
    specStatus: opts.specStatus ?? "SOURCED",
    verifiedAt: null,
    verifiedBy: null,
    verificationNote: null,
    components: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("evaluateCatalogMatches", () => {
  it("links the one build sheet whose model, brand and year all match exactly", () => {
    const exact = row("Fuel EX 8 XT");
    const result = evaluateCatalogMatches([exact, row("Fuel EX 5")], "Trek", "Fuel EX 8 XT", 2021);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.bike.id, exact.id);
  });

  it("never picks a trim when a model name covers several builds", () => {
    const xt = row("Fuel EX 8 XT");
    const gx = row("Fuel EX 8 GX AXS");
    const result = evaluateCatalogMatches([xt, gx], "Trek", "Fuel EX 8", 2021);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "ambiguous");
    assert.deepEqual(!result.ok && result.ambiguousIds?.sort(), [xt.id, gx.id].sort());
  });

  it("does not assume the only known trim is the bike's trim", () => {
    // Only the XT is in the catalog; "Fuel EX 8" might still be the GX.
    const xt = row("Fuel EX 8 XT");
    const result = evaluateCatalogMatches([xt], "Trek", "Fuel EX 8", 2021);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "low_confidence");
    assert.equal(!result.ok && result.candidates?.[0].id, xt.id);
  });

  it("offers an approximate row but never auto-matches it", () => {
    const approx = row("Stumpjumper", { brand: "Specialized", yearStart: 2005, yearEnd: 2010, specStatus: "APPROXIMATE" });
    const result = evaluateCatalogMatches([approx], "Specialized", "Stumpjumper", 2007);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "low_confidence");
    assert.equal(!result.ok && result.candidates?.[0].id, approx.id);
  });

  it("an approximate row doesn't make an exact sourced row ambiguous", () => {
    const approx = row("Stumpjumper", { brand: "Specialized", yearStart: 2005, yearEnd: 2010, specStatus: "APPROXIMATE" });
    const sourced = row("Stumpjumper", { brand: "Specialized", yearStart: 2007, specStatus: "SOURCED" });
    const result = evaluateCatalogMatches([approx, sourced], "Specialized", "Stumpjumper", 2007);
    assert.equal(result.ok && result.bike.id, sourced.id);
  });

  it("treats a year one outside the span as a possible match, not a match", () => {
    const r2021 = row("Fuel EX 8 XT", { yearStart: 2019, yearEnd: 2021 });
    const result = evaluateCatalogMatches([r2021], "Trek", "Fuel EX 8 XT", 2022);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "low_confidence");
    assert.equal(!result.ok && result.candidates?.[0].id, r2021.id);
  });

  it("matches anywhere inside a year span", () => {
    const span = row("Marlin 7", { yearStart: 2019, yearEnd: 2021 });
    assert.equal(evaluateCatalogMatches([span], "Trek", "Marlin 7", 2020).ok, true);
  });

  it("drops rows two or more years away and names the closest years", () => {
    const old = row("Fuel EX 8 XT", { yearStart: 2018, yearEnd: 2018 });
    const result = evaluateCatalogMatches([old], "Trek", "Fuel EX 8 XT", 2021);
    assert.equal(!result.ok && result.reason, "no_results");
    assert.match((!result.ok && result.message) || "", /2018/);
  });

  it("won't auto-match without a job year", () => {
    const result = evaluateCatalogMatches([row("Fuel EX 8 XT")], "Trek", "Fuel EX 8 XT", null);
    assert.equal(result.ok, false);
  });

  it("won't auto-match on a near brand spelling", () => {
    const result = evaluateCatalogMatches([row("Fuel EX 8 XT")], "Trek Bicycle", "Fuel EX 8 XT", 2021);
    assert.equal(result.ok, false);
  });

  it("matches a brand alias", () => {
    const r = row("Stumpjumper Comp", { brand: "Specialized", aliases: ["SBC"] });
    assert.equal(evaluateCatalogMatches([r], "SBC", "Stumpjumper Comp", 2021).ok, true);
  });

  it("doesn't list same-brand bikes with unrelated models as possible matches", () => {
    const result = evaluateCatalogMatches([row("Marlin 5")], "Trek", "Fuel EX 8", 2021);
    assert.equal(!result.ok && result.reason, "no_results");
  });

  it("ignores punctuation and case in model names", () => {
    assert.equal(normalizeModelName("Fuel EX-8  XT"), normalizeModelName("fuel ex 8 xt"));
    assert.equal(evaluateCatalogMatches([row("Fuel EX 8 XT")], "trek", "fuel ex-8 xt", 2021).ok, true);
  });

  it("decides the same without parts loaded (the pool is read without them)", () => {
    const strip = (bike: CatalogBikeWithRelations) => {
      const rest: Partial<CatalogBikeWithRelations> = { ...bike };
      delete rest.components;
      return rest as Omit<CatalogBikeWithRelations, "components">;
    };
    const pools = [
      [row("Fuel EX 8 XT"), row("Fuel EX 5")],
      [row("Fuel EX 8 XT"), row("Fuel EX 8 GX")],
      [row("Stumpjumper", { specStatus: "APPROXIMATE", brand: "Specialized" })],
    ];
    const inputs: Array<[string, string, number]> = [
      ["Trek", "Fuel EX 8 XT", 2021],
      ["Trek", "Fuel EX 8", 2021],
      ["Specialized", "Stumpjumper", 2021],
    ];
    pools.forEach((pool, i) => {
      const withParts = evaluateCatalogMatches(pool, ...inputs[i]);
      const without = evaluateCatalogMatches(pool.map(strip), ...inputs[i]);
      assert.equal(without.ok, withParts.ok);
      if (withParts.ok && without.ok) assert.equal(without.bike.id, withParts.bike.id);
      if (!withParts.ok && !without.ok) {
        assert.equal(without.reason, withParts.reason);
        assert.deepEqual(without.candidates?.map((c) => c.id), withParts.candidates?.map((c) => c.id));
      }
    });
  });
});
