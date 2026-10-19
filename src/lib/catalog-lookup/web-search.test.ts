import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLookupResult, type RawLookupResult } from "./web-search";

const TREK_PAGE = "https://www.trekbikes.com/us/en_US/bikes/fuel-ex-8-xt/p/123/";
const REVIEW_PAGE = "https://www.vitalmtb.com/product/guide/Bikes,3/Trek/Fuel-EX-8-XT,31285";

function part(slot: string, value: string, sourceUrl: string, sourceIsManufacturer: boolean) {
  return { slot, value, standard: null, sourceUrl, sourceIsManufacturer } as RawLookupResult["variants"][number]["components"][number];
}

function variant(model: string, components: RawLookupResult["variants"][number]["components"]) {
  return { model, family: "Fuel EX", category: "Mountain", subcategory: null, components };
}

const threeParts = (url: string, mfr: boolean) => [
  part("REAR_DERAILLEUR", "Shimano XT M8100", url, mfr),
  part("CASSETTE", "Shimano XT M8100 10-51T", url, mfr),
  part("BOTTOM_BRACKET", "Shimano MT500 press-fit", url, mfr),
];

function result(overrides: Partial<RawLookupResult>): RawLookupResult {
  return {
    found: true,
    brandName: "Trek",
    manufacturerDomain: "trekbikes.com",
    configurationsComplete: true,
    lineupSourceUrl: "https://www.trekbikes.com/us/en_US/bikes/fuel-ex/2021/",
    variants: [variant("Fuel EX 8 XT", threeParts(TREK_PAGE, true))],
    ...overrides,
  };
}

describe("validateLookupResult", () => {
  it("labels parts from the brand's own site as manufacturer specs", () => {
    const out = validateLookupResult(result({}))!;
    assert.ok(out.variants[0].components.every((c) => c.source === "MANUFACTURER"));
    assert.equal(out.variants[0].sourceUrl, TREK_PAGE);
  });

  it("doesn't take the model's word that a review site is the manufacturer", () => {
    const out = validateLookupResult(result({ variants: [variant("Fuel EX 8 XT", threeParts(REVIEW_PAGE, true))] }))!;
    assert.ok(out.variants[0].components.every((c) => c.source === "THIRD_PARTY"));
  });

  it("doesn't accept a 'manufacturer domain' that isn't the brand's", () => {
    const out = validateLookupResult(
      result({
        manufacturerDomain: "vitalmtb.com",
        variants: [variant("Fuel EX 8 XT", threeParts(REVIEW_PAGE, true))],
      })
    )!;
    assert.ok(out.variants[0].components.every((c) => c.source === "THIRD_PARTY"));
  });

  it("drops parts with no readable source page", () => {
    const out = validateLookupResult(
      result({
        variants: [
          variant("Fuel EX 8 XT", [...threeParts(TREK_PAGE, true), part("FORK", "Fox 34", "not a url", true)]),
        ],
      })
    )!;
    assert.equal(out.variants[0].components.some((c) => c.slot === "FORK"), false);
  });

  it("keeps the first value when a slot is listed twice", () => {
    const out = validateLookupResult(
      result({
        variants: [
          variant("Fuel EX 8 XT", [...threeParts(TREK_PAGE, true), part("CASSETTE", "Something else", TREK_PAGE, true)]),
        ],
      })
    )!;
    assert.equal(out.variants[0].components.filter((c) => c.slot === "CASSETTE").length, 1);
    assert.equal(out.variants[0].components.find((c) => c.slot === "CASSETTE")?.value, "Shimano XT M8100 10-51T");
  });

  it("keeps every build, and the list stays complete when nothing was dropped", () => {
    const out = validateLookupResult(
      result({
        variants: [
          variant("Fuel EX 8 XT", threeParts(TREK_PAGE, true)),
          variant("Fuel EX 8 GX AXS", threeParts(TREK_PAGE, true)),
        ],
      })
    )!;
    assert.deepEqual(out.variants.map((v) => v.model), ["Fuel EX 8 XT", "Fuel EX 8 GX AXS"]);
    assert.equal(out.configurationsComplete, true);
  });

  it("marks the build list incomplete when a thinly sourced build is dropped", () => {
    const out = validateLookupResult(
      result({
        variants: [
          variant("Fuel EX 8 XT", threeParts(TREK_PAGE, true)),
          variant("Fuel EX 8 GX AXS", [part("CASSETTE", "SRAM", TREK_PAGE, true)]),
        ],
      })
    )!;
    assert.equal(out.variants.length, 1);
    assert.equal(out.configurationsComplete, false);
  });

  it("doesn't call one build 'all the builds' without a manufacturer lineup page", () => {
    // The model says complete, but cites no lineup page.
    const noPage = validateLookupResult(result({ lineupSourceUrl: null }))!;
    assert.equal(noPage.variants.length, 1);
    assert.equal(noPage.configurationsComplete, false);
    // …or cites a review site's lineup.
    const reviewPage = validateLookupResult(result({ lineupSourceUrl: REVIEW_PAGE }))!;
    assert.equal(reviewPage.configurationsComplete, false);
    assert.equal(reviewPage.lineupSourceUrl, null);
    // With the brand's own lineup page, one build can be the whole lineup.
    const confirmed = validateLookupResult(result({}))!;
    assert.equal(confirmed.configurationsComplete, true);
    assert.match(confirmed.lineupSourceUrl ?? "", /trekbikes\.com/);
  });

  it("returns nothing when the search found nothing usable", () => {
    assert.equal(validateLookupResult(result({ found: false })), null);
    assert.equal(validateLookupResult(result({ variants: [] })), null);
  });
});
