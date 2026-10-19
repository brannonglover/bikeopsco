import { FIT_CRITICAL } from "./fit";
import { normalizeModelName } from "./match";
import { SLOT_META } from "./slots";
import { formatYearSpan, spanEnd } from "./years";
import type { CatalogComponentSlot } from "../generated/client";

/**
 * Which catalog rows could be consolidated into one year-spanning row — and,
 * more importantly, which can't. Pure: no database, no writes. The report
 * script feeds it rows and renders what it returns; nothing here applies a
 * merge.
 *
 * Conservative by design:
 * - Only rows of the same brand AND the same model name (trim included) are
 *   compared, so different trims never merge.
 * - Only consecutive years are compared.
 * - Any part that differs keeps the rows separate.
 * - Missing information is never agreement: a part listed on one row but not
 *   the other, or a fit-critical part missing from either, sends the pair to
 *   review instead of merging.
 * - Approximate rows can't prove anything by matching text, so they only
 *   qualify when they're literal copies of one seed template.
 * - Verification must match exactly, so a merge never spreads a verified part
 *   to years nobody verified.
 */

export type ConsolidationComponent = {
  slot: string;
  value: string;
  standard: string | null;
  detail: string | null;
  source: string;
  sourceUrl: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
};

export type ConsolidationRow = {
  id: string;
  brandId: string;
  brandName: string;
  model: string;
  family: string | null;
  category: string | null;
  subcategory: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  specStatus: "APPROXIMATE" | "SOURCED" | "VERIFIED";
  verifiedAt: Date | null;
  verifiedBy: string | null;
  sourceUrl: string | null;
  externalKey: string;
  updatedAt: Date;
  components: ConsolidationComponent[];
};

/**
 * Fit-critical parts that must be present AND identical on both rows before a
 * merge is safe (on top of every other part being identical). Wheel spacing
 * counts if stated by AXLE or by both hubs.
 */
export const REQUIRED_FOR_MERGE: CatalogComponentSlot[] = [
  "BOTTOM_BRACKET",
  "HEADSET",
  "WHEEL_SIZE",
  "BRAKES",
  "FORK",
  "CASSETTE",
];
const SPACING_ALTERNATIVES: CatalogComponentSlot[][] = [["AXLE"], ["FRONT_HUB", "REAR_HUB"]];
/** A full-suspension bike also needs its shock confirmed. */
const SUSPENSION_SLOTS: CatalogComponentSlot[] = ["REAR_SHOCK", "REAR_TRAVEL"];

/** The note the old per-year seed appended to every part of a template copy. */
const TEMPLATE_NOTE = /Shared build sheet for (\d{4})–(\d{4})/;

export type SlotSide = {
  value: string;
  standard: string | null;
  source: string;
  sourceUrl: string | null;
  verified: boolean;
};

export type SlotComparison = {
  slot: string;
  label: string;
  fitCritical: boolean;
  a: SlotSide | null;
  b: SlotSide | null;
  /** same / different / only on the earlier row / only on the later row */
  result: "same" | "different" | "only_a" | "only_b";
};

export type PairVerdict =
  /** Every part present on both, identical, fit-critical evidence complete, verification identical. */
  | "safe"
  /** Both rows are copies of one hand-entered seed template (identical, same template span). */
  | "template_copy"
  /** Nothing differs, but the evidence isn't enough to say they're the same bike. */
  | "review"
  /** Something differs (or the years aren't consecutive) — they stay separate. */
  | "separate";

export type PairAssessment = {
  a: string;
  b: string;
  aYears: string;
  bYears: string;
  verdict: PairVerdict;
  /** Why, in plain words — every reason that applies, not just the first. */
  reasons: string[];
  comparisons: SlotComparison[];
};

export type ProposedMerge = {
  kind: "safe" | "template_copy";
  /** Keeps its id; its year span would widen. Earliest row of the run. */
  survivorId: string;
  /** Kept as-is and marked merged into the survivor (soft merge) — never deleted. */
  memberIds: string[];
  fromYears: string[];
  toYears: string;
};

export type GroupAnalysis = {
  brandName: string;
  model: string;
  rowIds: string[];
  pairs: PairAssessment[];
  merges: ProposedMerge[];
};

export type ConsolidationAnalysis = {
  groups: GroupAnalysis[];
  /** Same brand, model names that differ only in spacing/punctuation — never merged automatically. */
  similarNames: Array<{ brandName: string; models: string[]; rowIds: string[] }>;
  /** Rows without a year can't be placed in a span and are never merged. */
  undatedRowIds: string[];
  /** Rows with no other row of the same brand and model. */
  singletonCount: number;
};

function clean(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/, "")
    .trim();
}

function side(c: ConsolidationComponent | undefined): SlotSide | null {
  if (!c) return null;
  return {
    value: c.value,
    standard: c.standard,
    source: c.source,
    sourceUrl: c.sourceUrl,
    verified: c.verifiedAt != null,
  };
}

export function compareComponents(a: ConsolidationRow, b: ConsolidationRow): SlotComparison[] {
  const aBySlot = new Map(a.components.map((c) => [c.slot, c]));
  const bBySlot = new Map(b.components.map((c) => [c.slot, c]));
  const slots = [...new Set([...aBySlot.keys(), ...bBySlot.keys()])].sort(
    (x, y) =>
      (SLOT_META[x as CatalogComponentSlot]?.sortOrder ?? 999) -
        (SLOT_META[y as CatalogComponentSlot]?.sortOrder ?? 999) || x.localeCompare(y)
  );
  return slots.map((slot) => {
    const ca = aBySlot.get(slot);
    const cb = bBySlot.get(slot);
    const result: SlotComparison["result"] = !ca
      ? "only_b"
      : !cb
        ? "only_a"
        : clean(ca.value) === clean(cb.value) && clean(ca.standard) === clean(cb.standard)
          ? "same"
          : "different";
    return {
      slot,
      label: SLOT_META[slot as CatalogComponentSlot]?.label ?? slot,
      fitCritical: slot in FIT_CRITICAL,
      a: side(ca),
      b: side(cb),
      result,
    };
  });
}

function templateSpan(row: ConsolidationRow): string | null {
  if (row.components.length === 0) return null;
  const spans = row.components.map((c) => c.detail?.match(TEMPLATE_NOTE)?.slice(1, 3).join("–") ?? null);
  return spans.every((s) => s && s === spans[0]) ? spans[0] : null;
}

/** Fit-critical evidence a row is missing (empty = complete). */
export function missingRequiredEvidence(row: ConsolidationRow, other?: ConsolidationRow): string[] {
  const has = new Set(row.components.map((c) => c.slot));
  const missing = REQUIRED_FOR_MERGE.filter((s) => !has.has(s)).map((s) => SLOT_META[s].label);
  if (!SPACING_ALTERNATIVES.some((alt) => alt.every((s) => has.has(s)))) {
    missing.push("Axle or hub spacing");
  }
  const otherHas = new Set(other?.components.map((c) => c.slot) ?? []);
  const fullSuspension = SUSPENSION_SLOTS.some((s) => has.has(s) || otherHas.has(s));
  if (fullSuspension && !has.has("REAR_SHOCK")) missing.push(SLOT_META.REAR_SHOCK.label);
  return missing;
}

export function assessPair(a: ConsolidationRow, b: ConsolidationRow): PairAssessment {
  const comparisons = compareComponents(a, b);
  const separate: string[] = [];
  const review: string[] = [];

  const aEnd = spanEnd(a) ?? a.yearStart!;
  const gap = b.yearStart! - aEnd;
  if (gap > 1) separate.push(`Years aren’t consecutive (${aEnd} then ${b.yearStart})`);
  if (gap < 1) review.push("Year spans overlap — two rows describe the same year");

  const different = comparisons.filter((c) => c.result === "different");
  for (const c of different) {
    separate.push(`${c.label} differs${c.fitCritical ? " (fit-critical)" : ""}`);
  }
  if (clean(a.category) && clean(b.category) && clean(a.category) !== clean(b.category)) {
    separate.push(`Category differs (${a.category} vs ${b.category})`);
  }
  if (clean(a.subcategory) && clean(b.subcategory) && clean(a.subcategory) !== clean(b.subcategory)) {
    separate.push(`Subcategory differs (${a.subcategory} vs ${b.subcategory})`);
  }
  const approxA = a.specStatus === "APPROXIMATE";
  const approxB = b.specStatus === "APPROXIMATE";
  if (approxA !== approxB) {
    separate.push("One row is an approximate guide, the other a sourced or verified build sheet");
  }

  const oneSided = comparisons.filter((c) => c.result === "only_a" || c.result === "only_b");
  for (const c of oneSided) {
    review.push(`${c.label} is listed only for ${c.result === "only_a" ? a.yearStart : b.yearStart} — missing isn’t agreement`);
  }
  if (clean(a.family) !== clean(b.family)) review.push("Model family differs");

  // Literal copies of one seed template: merging them asserts nothing new.
  const tA = approxA ? templateSpan(a) : null;
  const tB = approxB ? templateSpan(b) : null;
  const insideTemplate = (row: ConsolidationRow, span: string | null) => {
    if (!span) return false;
    const [from, to] = span.split("–").map(Number);
    return row.yearStart! >= from && (spanEnd(row) ?? row.yearStart!) <= to;
  };
  const isTemplateCopy =
    approxA &&
    approxB &&
    tA != null &&
    tA === tB &&
    insideTemplate(a, tA) &&
    insideTemplate(b, tB) &&
    separate.length === 0 &&
    oneSided.length === 0 &&
    gap === 1;

  if (approxA && approxB && !isTemplateCopy) {
    review.push("Both rows are approximate guides — matching text isn’t evidence they’re the same bike");
  }

  if (!approxA && !approxB) {
    const missA = missingRequiredEvidence(a, b);
    const missB = missingRequiredEvidence(b, a);
    const missing = [...new Set([...missA, ...missB])];
    if (missing.length > 0) review.push(`Fit-critical evidence missing: ${missing.join(", ")}`);
    if (a.specStatus !== b.specStatus) {
      review.push(`Verification differs (${a.specStatus} vs ${b.specStatus}) — a merge mustn’t spread it`);
    }
    const verifiedMismatch = comparisons.filter(
      (c) => c.result === "same" && (c.a?.verified ?? false) !== (c.b?.verified ?? false)
    );
    if (verifiedMismatch.length > 0) {
      review.push(
        `Verified for one year only: ${verifiedMismatch.map((c) => c.label).join(", ")} — a merge mustn’t spread it`
      );
    }
  }

  const verdict: PairVerdict =
    separate.length > 0 ? "separate" : isTemplateCopy ? "template_copy" : review.length > 0 ? "review" : "safe";
  return {
    a: a.id,
    b: b.id,
    aYears: formatYearSpan(a) ?? "no year",
    bYears: formatYearSpan(b) ?? "no year",
    verdict,
    reasons:
      verdict === "separate"
        ? [...separate, ...review]
        : verdict === "template_copy"
          ? [`Both are copies of the ${tA} seed template — identical parts, nothing new is claimed`]
          : review,
    comparisons,
  };
}

function groupKey(row: ConsolidationRow): string {
  return `${row.brandId}|${normalizeModelName(row.model)}`;
}

/** Analyse the whole catalog. Rows the same brand and model (trim included) are compared year to year. */
export function analyzeConsolidation(rows: ConsolidationRow[]): ConsolidationAnalysis {
  const undatedRowIds = rows.filter((r) => r.yearStart == null).map((r) => r.id);
  const byGroup = new Map<string, ConsolidationRow[]>();
  for (const row of rows) {
    if (row.yearStart == null) continue;
    byGroup.set(groupKey(row), [...(byGroup.get(groupKey(row)) ?? []), row]);
  }

  const groups: GroupAnalysis[] = [];
  let singletonCount = 0;
  for (const members of byGroup.values()) {
    if (members.length < 2) {
      singletonCount += 1;
      continue;
    }
    const sorted = [...members].sort(
      (x, y) => x.yearStart! - y.yearStart! || (spanEnd(x) ?? 0) - (spanEnd(y) ?? 0) || x.id.localeCompare(y.id)
    );
    const pairs = sorted.slice(1).map((row, i) => assessPair(sorted[i], row));

    // A merge is a run of consecutive rows where every link is the same kind
    // of clean match. Anything else breaks the run.
    const merges: ProposedMerge[] = [];
    let run: ConsolidationRow[] = [sorted[0]];
    let runKind: "safe" | "template_copy" | null = null;
    const flush = () => {
      if (run.length > 1 && runKind) {
        merges.push({
          kind: runKind,
          survivorId: run[0].id,
          memberIds: run.slice(1).map((r) => r.id),
          fromYears: run.map((r) => formatYearSpan(r)!),
          toYears: formatYearSpan({
            yearStart: run[0].yearStart,
            yearEnd: Math.max(...run.map((r) => spanEnd(r)!)),
          })!,
        });
      }
    };
    pairs.forEach((pair, i) => {
      const next = sorted[i + 1];
      const mergeable = pair.verdict === "safe" || pair.verdict === "template_copy";
      if (mergeable && (runKind == null || runKind === pair.verdict)) {
        runKind = pair.verdict as "safe" | "template_copy";
        run.push(next);
      } else {
        flush();
        run = [next];
        runKind = mergeable ? (pair.verdict as "safe" | "template_copy") : null;
        if (mergeable) run = [sorted[i], next];
      }
    });
    flush();

    groups.push({
      brandName: sorted[0].brandName,
      model: sorted[0].model,
      rowIds: sorted.map((r) => r.id),
      pairs,
      merges,
    });
  }

  // Same brand, names equal once spaces and punctuation are ignored, but not
  // equal as written ("Fuel EX 8" / "FuelEX 8"): possibly one bike, typed two ways.
  const compactGroups = new Map<string, ConsolidationRow[]>();
  for (const row of rows) {
    const key = `${row.brandId}|${normalizeModelName(row.model).replace(/ /g, "")}`;
    compactGroups.set(key, [...(compactGroups.get(key) ?? []), row]);
  }
  const similarNames = [...compactGroups.values()]
    .filter((list) => new Set(list.map((r) => normalizeModelName(r.model))).size > 1)
    .map((list) => ({
      brandName: list[0].brandName,
      models: [...new Set(list.map((r) => r.model))],
      rowIds: list.map((r) => r.id),
    }));

  return { groups, similarNames, undatedRowIds, singletonCount };
}
