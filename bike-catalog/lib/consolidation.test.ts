import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeConsolidation, assessPair, type ConsolidationComponent, type ConsolidationRow } from "./consolidation";

let seq = 0;

function part(slot: string, value: string, extra: Partial<ConsolidationComponent> = {}): ConsolidationComponent {
  return {
    slot,
    value,
    standard: null,
    detail: null,
    source: "THIRD_PARTY",
    sourceUrl: "https://example.com/spec",
    verifiedAt: null,
    verifiedBy: null,
    ...extra,
  };
}

/** Every fit-critical part a safe merge needs, hardtail. */
function fullEvidence(overrides: Record<string, string> = {}): ConsolidationComponent[] {
  const base: Record<string, string> = {
    BOTTOM_BRACKET: "Shimano MT500 BB92",
    HEADSET: "Tapered 1-1/8 to 1.5",
    WHEEL_SIZE: '29"',
    BRAKES: "Shimano MT420 post mount",
    FORK: "Fox 34 Rhythm 140mm",
    CASSETTE: "Shimano XT M8100 10-51 Micro Spline",
    AXLE: "Boost 110x15 / 148x12",
    REAR_DERAILLEUR: "Shimano XT M8100",
    ...overrides,
  };
  return Object.entries(base).map(([slot, value]) => part(slot, value));
}

function row(
  model: string,
  year: number | null,
  components: ConsolidationComponent[],
  extra: Partial<ConsolidationRow> = {}
): ConsolidationRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    brandId: "brand-trek",
    brandName: "Trek",
    model,
    family: null,
    category: "Mountain",
    subcategory: null,
    yearStart: year,
    yearEnd: year,
    specStatus: "SOURCED",
    verifiedAt: null,
    verifiedBy: null,
    sourceUrl: null,
    externalKey: `key-${seq}`,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    components,
    ...extra,
  };
}

function templateParts(span: string): ConsolidationComponent[] {
  const note = `Shared build sheet for ${span}`;
  return [
    part("FRAME_MATERIAL", "Aluminum", { source: "APPROXIMATE", sourceUrl: null, detail: note }),
    part("REAR_DERAILLEUR", "Shimano Deore / LX", { source: "APPROXIMATE", sourceUrl: null, detail: note }),
  ];
}

describe("assessPair", () => {
  it("is safe only when every part is on both rows, identical, with full fit-critical evidence", () => {
    const pair = assessPair(row("Marlin 7", 2019, fullEvidence()), row("Marlin 7", 2020, fullEvidence()));
    assert.equal(pair.verdict, "safe", pair.reasons.join("; "));
  });

  it("doesn't treat a fit-critical part missing from both rows as agreement", () => {
    const parts = fullEvidence();
    const noBB = parts.filter((p) => p.slot !== "BOTTOM_BRACKET");
    const pair = assessPair(row("Marlin 7", 2019, noBB), row("Marlin 7", 2020, noBB.map((p) => ({ ...p }))));
    assert.equal(pair.verdict, "review");
    assert.match(pair.reasons.join(" "), /Fit-critical evidence missing: Bottom bracket/);
  });

  it("doesn't treat a part listed for one year only as agreement", () => {
    const pair = assessPair(
      row("Marlin 7", 2019, [...fullEvidence(), part("SADDLE", "Bontrager Arvada")]),
      row("Marlin 7", 2020, fullEvidence())
    );
    assert.equal(pair.verdict, "review");
    assert.match(pair.reasons.join(" "), /Saddle is listed only for 2019/);
  });

  it("keeps rows separate when a fit-critical standard changed even though the groupset didn't", () => {
    const pair = assessPair(
      row("Marlin 7", 2019, fullEvidence()),
      row("Marlin 7", 2020, fullEvidence({ BOTTOM_BRACKET: "Threaded BSA 73mm" }))
    );
    assert.equal(pair.verdict, "separate");
    assert.match(pair.reasons.join(" "), /Bottom bracket differs \(fit-critical\)/);
    const bb = pair.comparisons.find((c) => c.slot === "BOTTOM_BRACKET")!;
    assert.equal(bb.result, "different");
  });

  it("compares the fit standard too, not just the part name", () => {
    const a = fullEvidence();
    const b = fullEvidence().map((p) => (p.slot === "AXLE" ? { ...p, standard: "Boost" } : p));
    assert.equal(assessPair(row("Marlin 7", 2019, a), row("Marlin 7", 2020, b)).verdict, "separate");
  });

  it("requires the rear shock on a full-suspension bike", () => {
    const parts = [...fullEvidence(), part("REAR_TRAVEL", "130mm")];
    const pair = assessPair(row("Fuel EX 8", 2019, parts), row("Fuel EX 8", 2020, parts.map((p) => ({ ...p }))));
    assert.equal(pair.verdict, "review");
    assert.match(pair.reasons.join(" "), /Rear shock/);
  });

  it("accepts both hubs in place of the axle for wheel spacing", () => {
    const parts = fullEvidence()
      .filter((p) => p.slot !== "AXLE")
      .concat(part("FRONT_HUB", "Boost 110x15"), part("REAR_HUB", "Boost 148x12"));
    assert.equal(assessPair(row("Marlin 7", 2019, parts), row("Marlin 7", 2020, parts.map((p) => ({ ...p })))).verdict, "safe");
  });

  it("won't merge across a gap in years", () => {
    const pair = assessPair(row("Marlin 7", 2018, fullEvidence()), row("Marlin 7", 2020, fullEvidence()));
    assert.equal(pair.verdict, "separate");
    assert.match(pair.reasons.join(" "), /aren’t consecutive/);
  });

  it("won't spread a verification to a year nobody verified", () => {
    const verified = fullEvidence().map((p) =>
      p.slot === "BOTTOM_BRACKET" ? { ...p, verifiedAt: new Date(), verifiedBy: "admin@example.com" } : p
    );
    const pair = assessPair(row("Marlin 7", 2019, verified), row("Marlin 7", 2020, fullEvidence()));
    assert.equal(pair.verdict, "review");
    assert.match(pair.reasons.join(" "), /Verified for one year only: Bottom bracket/);

    const statusPair = assessPair(
      row("Marlin 7", 2019, fullEvidence(), { specStatus: "VERIFIED" }),
      row("Marlin 7", 2020, fullEvidence())
    );
    assert.equal(statusPair.verdict, "review");
  });

  it("never merges an approximate guide with a sourced build sheet", () => {
    const pair = assessPair(
      row("Marlin 7", 2019, fullEvidence(), { specStatus: "APPROXIMATE" }),
      row("Marlin 7", 2020, fullEvidence())
    );
    assert.equal(pair.verdict, "separate");
  });

  it("sends identical approximate rows to review — matching text proves nothing", () => {
    const parts = templateParts("2018–2020").map((p) => ({ ...p, detail: null }));
    const pair = assessPair(
      row("Stumpjumper", 2018, parts, { specStatus: "APPROXIMATE" }),
      row("Stumpjumper", 2019, parts.map((p) => ({ ...p })), { specStatus: "APPROXIMATE" })
    );
    assert.equal(pair.verdict, "review");
  });

  it("recognises literal copies of one seed template", () => {
    const pair = assessPair(
      row("Stumpjumper", 2018, templateParts("2018–2020"), { specStatus: "APPROXIMATE" }),
      row("Stumpjumper", 2019, templateParts("2018–2020"), { specStatus: "APPROXIMATE" })
    );
    assert.equal(pair.verdict, "template_copy");
  });

  it("doesn't call rows from two different templates copies", () => {
    const pair = assessPair(
      row("Stumpjumper", 2020, templateParts("2018–2020"), { specStatus: "APPROXIMATE" }),
      row("Stumpjumper", 2021, templateParts("2021–2024"), { specStatus: "APPROXIMATE" })
    );
    assert.notEqual(pair.verdict, "template_copy");
  });
});

describe("analyzeConsolidation", () => {
  it("never compares different trims, however alike", () => {
    const analysis = analyzeConsolidation([
      row("Fuel EX 8 XT", 2021, fullEvidence()),
      row("Fuel EX 8 GX", 2021, fullEvidence()),
    ]);
    assert.equal(analysis.groups.length, 0);
    assert.equal(analysis.singletonCount, 2);
  });

  it("proposes one soft merge per clean run and breaks the run where something changes", () => {
    const a = row("Marlin 7", 2018, fullEvidence());
    const b = row("Marlin 7", 2019, fullEvidence());
    const c = row("Marlin 7", 2020, fullEvidence({ BOTTOM_BRACKET: "Threaded BSA 73mm" }));
    const d = row("Marlin 7", 2021, fullEvidence({ BOTTOM_BRACKET: "Threaded BSA 73mm" }));
    const [group] = analyzeConsolidation([d, b, c, a]).groups;
    assert.deepEqual(
      group.merges.map((m) => ({ survivor: m.survivorId, members: m.memberIds, years: m.toYears })),
      [
        { survivor: a.id, members: [b.id], years: "2018–2019" },
        { survivor: c.id, members: [d.id], years: "2020–2021" },
      ]
    );
    assert.deepEqual(group.pairs.map((p) => p.verdict), ["safe", "separate", "safe"]);
  });

  it("merges a whole seed template's copies into its span", () => {
    const rows = [2018, 2019, 2020].map((y) =>
      row("Stumpjumper", y, templateParts("2018–2020"), { specStatus: "APPROXIMATE" })
    );
    const [group] = analyzeConsolidation(rows).groups;
    assert.equal(group.merges.length, 1);
    assert.equal(group.merges[0].kind, "template_copy");
    assert.equal(group.merges[0].toYears, "2018–2020");
    assert.equal(group.merges[0].memberIds.length, 2);
  });

  it("doesn't mix a template run and a sourced run into one merge", () => {
    const rows = [
      row("Stumpjumper", 2018, templateParts("2018–2019"), { specStatus: "APPROXIMATE" }),
      row("Stumpjumper", 2019, templateParts("2018–2019"), { specStatus: "APPROXIMATE" }),
      row("Stumpjumper", 2020, fullEvidence()),
      row("Stumpjumper", 2021, fullEvidence()),
    ];
    const [group] = analyzeConsolidation(rows).groups;
    assert.deepEqual(group.merges.map((m) => [m.kind, m.toYears]), [
      ["template_copy", "2018–2019"],
      ["safe", "2020–2021"],
    ]);
  });

  it("leaves undated rows out and flags names that differ only in spacing", () => {
    const analysis = analyzeConsolidation([
      row("Fuel EX 8", 2021, fullEvidence()),
      row("FuelEX 8", 2021, fullEvidence()),
      row("Marlin 7", null, fullEvidence()),
    ]);
    assert.equal(analysis.undatedRowIds.length, 1);
    assert.deepEqual(analysis.similarNames[0].models.sort(), ["Fuel EX 8", "FuelEX 8"]);
  });
});
