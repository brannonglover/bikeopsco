import { createHash } from "crypto";
import {
  REQUIRED_FOR_MERGE,
  type ConsolidationAnalysis,
  type ConsolidationRow,
  type PairAssessment,
  type ProposedMerge,
  type SlotComparison,
} from "./consolidation";
import { SLOT_META } from "./slots";
import { formatYearSpan } from "./years";

/**
 * Renders a consolidation analysis as a read-only review document (Markdown)
 * and a machine-readable plan (JSON). Pure: the caller supplies rows,
 * references and metadata; nothing is written to any database.
 */

export type RowReferences = {
  jobBikes: Array<{ jobBikeId: string; jobId: string; stage: string }>;
  customerBikes: Array<{ bikeId: string; confirmed: boolean }>;
  lookupKeys: string[];
};

export type ReportMeta = {
  generatedAt: Date;
  database: { host: string; projectRef: string | null; environment: "production" | "staging" | "unknown" };
};

const CLOSED_STAGES = new Set(["COMPLETED", "CANCELLED"]);

export const MERGE_CRITERIA: string[] = [
  "Only rows with the same brand and the same model name — trim included — are compared. Different trims are never merged, however alike their parts.",
  "Only consecutive model years are compared; a gap of a year or more keeps rows apart.",
  "Every part is compared on its value and its fit standard. If any part differs, the rows stay separate.",
  "Missing information is never agreement: a part listed for one year but not the other sends the pair to review.",
  `A merge of sourced or verified rows also needs these fit-critical parts present and identical on both: ${REQUIRED_FOR_MERGE.map((s) => SLOT_META[s].label).join(", ")}, wheel spacing (axle, or both hubs), and the rear shock on full-suspension bikes.`,
  "An approximate guide is never merged with a sourced or verified build sheet.",
  "Two approximate rows only qualify when they are literal copies of one hand-entered seed template (same parts, same “Shared build sheet for …” span). Merging them restores the template; it claims nothing new and the result stays Approximate.",
  "Verification must already match exactly (row status and each part). A merge never spreads a verified part or build to a year nobody verified.",
  "Nothing is deleted. A merge would be a soft merge: the earliest row's span widens, the others are kept intact and marked as merged into it, and every id stays valid (see the appendix).",
];

function stageBucket(stage: string): "active" | "completed" | "cancelled" {
  if (stage === "CANCELLED") return "cancelled";
  return CLOSED_STAGES.has(stage) ? "completed" : "active";
}

type RefSummary = {
  activeJobs: number;
  completedJobs: number;
  cancelledJobs: number;
  jobIds: string[];
  customerBikes: number;
  confirmedBuilds: number;
  lookups: number;
};

function summarizeRefs(ids: string[], refs: Map<string, RowReferences>): RefSummary {
  const out: RefSummary = {
    activeJobs: 0,
    completedJobs: 0,
    cancelledJobs: 0,
    jobIds: [],
    customerBikes: 0,
    confirmedBuilds: 0,
    lookups: 0,
  };
  for (const id of ids) {
    const r = refs.get(id);
    if (!r) continue;
    for (const jb of r.jobBikes) {
      const bucket = stageBucket(jb.stage);
      if (bucket === "active") out.activeJobs += 1;
      else if (bucket === "completed") out.completedJobs += 1;
      else out.cancelledJobs += 1;
      out.jobIds.push(jb.jobId);
    }
    out.customerBikes += r.customerBikes.length;
    out.confirmedBuilds += r.customerBikes.filter((b) => b.confirmed).length;
    out.lookups += r.lookupKeys.length;
  }
  out.jobIds = [...new Set(out.jobIds)];
  return out;
}

function rowSummary(row: ConsolidationRow, refs: Map<string, RowReferences>) {
  const verifiedParts = row.components.filter((c) => c.verifiedAt).length;
  return {
    id: row.id,
    years: formatYearSpan(row) ?? "no year",
    specStatus: row.specStatus,
    parts: row.components.length,
    verifiedParts,
    sources: [...new Set(row.components.map((c) => c.sourceUrl).filter((u): u is string => Boolean(u)))],
    externalKey: row.externalKey,
    updatedAt: row.updatedAt.toISOString(),
    references: summarizeRefs([row.id], refs),
  };
}

function pairJson(pair: PairAssessment) {
  return {
    rows: [pair.a, pair.b],
    years: [pair.aYears, pair.bYears],
    verdict: pair.verdict,
    reasons: pair.reasons,
    partsCompared: pair.comparisons.length,
    same: pair.comparisons.filter((c) => c.result === "same").length,
    differences: pair.comparisons.filter((c) => c.result !== "same"),
  };
}

/** Fingerprint of the proposed merges and the rows they touch, so an apply step can refuse a stale plan. */
export function planHash(merges: ProposedMerge[], rowsById: Map<string, ConsolidationRow>): string {
  const payload = merges.map((m) => ({
    survivorId: m.survivorId,
    memberIds: m.memberIds,
    toYears: m.toYears,
    rows: [m.survivorId, ...m.memberIds].map((id) => [id, rowsById.get(id)?.updatedAt.toISOString() ?? null]),
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildConsolidationReport(
  rows: ConsolidationRow[],
  analysis: ConsolidationAnalysis,
  refs: Map<string, RowReferences>,
  meta: ReportMeta
): { json: ReportJson; markdown: string } {
  const json = buildReportJson(rows, analysis, refs, meta);
  return { json, markdown: renderMarkdown(json) };
}

function buildReportJson(
  rows: ConsolidationRow[],
  analysis: ConsolidationAnalysis,
  refs: Map<string, RowReferences>,
  meta: ReportMeta
) {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const allMerges = analysis.groups.flatMap((g) => g.merges.map((m) => ({ group: g, merge: m })));
  const reviewPairs = analysis.groups.flatMap((g) =>
    g.pairs.filter((p) => p.verdict === "review").map((pair) => ({ group: g, pair }))
  );
  const separatePairs = analysis.groups.flatMap((g) =>
    g.pairs.filter((p) => p.verdict === "separate").map((pair) => ({ group: g, pair }))
  );
  const mergedAway = allMerges.reduce((n, { merge }) => n + merge.memberIds.length, 0);

  const summary = {
    catalogRows: rows.length,
    modelGroupsCompared: analysis.groups.length,
    rowsWithNoSameModelRow: analysis.singletonCount,
    safeMerges: allMerges.filter(({ merge }) => merge.kind === "safe").length,
    templateCopyMerges: allMerges.filter(({ merge }) => merge.kind === "template_copy").length,
    rowsThatWouldBeMarkedMerged: mergedAway,
    rowsAfterMerges: rows.length - mergedAway,
    pairsNeedingReview: reviewPairs.length,
    pairsKeptSeparate: separatePairs.length,
    similarNamesNeedingReview: analysis.similarNames.length,
    undatedRows: analysis.undatedRowIds.length,
  };

  const mergesJson = allMerges.map(({ group, merge }) => {
    const ids = [merge.survivorId, ...merge.memberIds];
    return {
      kind: merge.kind,
      brand: group.brandName,
      model: group.model,
      toYears: merge.toYears,
      survivor: rowSummary(rowsById.get(merge.survivorId)!, refs),
      members: merge.memberIds.map((id) => rowSummary(rowsById.get(id)!, refs)),
      affected: summarizeRefs(ids, refs),
      comparisons: group.pairs
        .filter((p) => ids.includes(p.a) && ids.includes(p.b))
        .map(pairJson),
    };
  });

  const json = {
    kind: "bike-catalog-consolidation-report",
    readOnly: true,
    generatedAt: meta.generatedAt.toISOString(),
    database: meta.database,
    summary,
    criteria: MERGE_CRITERIA,
    safeMerges: mergesJson,
    needsReview: reviewPairs.map(({ group, pair }) => ({
      brand: group.brandName,
      model: group.model,
      ...pairJson(pair),
      rowsDetail: [pair.a, pair.b].map((id) => rowSummary(rowsById.get(id)!, refs)),
    })),
    keptSeparate: separatePairs.map(({ group, pair }) => ({
      brand: group.brandName,
      model: group.model,
      ...pairJson(pair),
    })),
    similarNames: analysis.similarNames.map((s) => ({
      ...s,
      references: summarizeRefs(s.rowIds, refs),
    })),
    undatedRows: analysis.undatedRowIds.map((id) => rowSummary(rowsById.get(id)!, refs)),
    plan: {
      note: "Proposal only. Applying it needs your explicit approval and a separate apply step that re-checks this hash.",
      hash: planHash(
        allMerges.map((m) => m.merge),
        rowsById
      ),
      merges: allMerges.map(({ merge }) => ({
        kind: merge.kind,
        survivorId: merge.survivorId,
        memberIds: merge.memberIds,
        toYears: merge.toYears,
      })),
    },
  };

  return json;
}

export type ReportJson = ReturnType<typeof buildReportJson>;

function cell(value: string | null | undefined): string {
  return (value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function sideText(side: SlotComparison["a"]): string {
  if (!side) return "*(not listed)*";
  const std = side.standard ? ` [${side.standard}]` : "";
  return `${cell(side.value)}${cell(std === "" ? "" : std)}${side.verified ? " ✓verified" : ""}`;
}

function refsText(r: RefSummary): string {
  const parts = [
    `${r.activeJobs} active job${r.activeJobs === 1 ? "" : "s"}`,
    `${r.completedJobs} completed`,
    `${r.cancelledJobs} cancelled`,
    `${r.customerBikes} customer bike${r.customerBikes === 1 ? "" : "s"} (${r.confirmedBuilds} confirmed build${r.confirmedBuilds === 1 ? "" : "s"})`,
    `${r.lookups} lookup record${r.lookups === 1 ? "" : "s"}`,
  ];
  return parts.join(" · ");
}

function differencesTable(diffs: SlotComparison[], years: string[]): string[] {
  if (diffs.length === 0) return [];
  return [
    `| Part | ${years[0]} | ${years[1]} | Result |`,
    "|---|---|---|---|",
    ...diffs.map(
      (d) =>
        `| ${d.label}${d.fitCritical ? " ⚠︎" : ""} | ${sideText(d.a)} | ${sideText(d.b)} | ${
          d.result === "different" ? "**differs**" : "missing on one side"
        } |`
    ),
  ];
}

function renderMarkdown(r: ReportJson): string {
  const s = r.summary;
  const lines: string[] = [
    "# Bike catalog consolidation report (read-only)",
    "",
    `Generated ${r.generatedAt} from **${r.database.environment}** (${r.database.host}${
      r.database.projectRef ? `, project ${r.database.projectRef}` : ""
    }). Read in read-only transactions; nothing was changed.`,
    "",
    "> Proposal only. No merge happens without your explicit approval and a separate apply step, which must re-check the plan fingerprint below.",
    "",
    "## Summary",
    "",
    "| | |",
    "|---|---|",
    `| Catalog rows | ${s.catalogRows} |`,
    `| Model groups compared (same brand + model, 2+ dated rows) | ${s.modelGroupsCompared} |`,
    `| Rows with no other row of the same model | ${s.rowsWithNoSameModelRow} |`,
    `| **Safe merge candidates** (sourced/verified, full evidence) | ${s.safeMerges} |`,
    `| **Seed-template copies** (approximate, literal duplicates) | ${s.templateCopyMerges} |`,
    `| Rows those merges would mark merged (kept, not deleted) | ${s.rowsThatWouldBeMarkedMerged} |`,
    `| Rows matching would see afterwards | ${s.rowsAfterMerges} |`,
    `| **Pairs needing review** | ${s.pairsNeedingReview} |`,
    `| **Pairs that must stay separate** | ${s.pairsKeptSeparate} |`,
    `| Similar model names needing review | ${s.similarNamesNeedingReview} |`,
    `| Undated rows (never merged) | ${s.undatedRows} |`,
    "",
    `Plan fingerprint: \`${r.plan.hash}\``,
    "",
    "## Merge criteria",
    "",
    ...r.criteria.map((c) => `- ${c}`),
    "",
    "⚠︎ marks a fit-critical part. “✓verified” marks a part an admin verified for that row.",
    "",
    "## 1. Safe merge candidates",
    "",
  ];

  if (r.safeMerges.length === 0) lines.push("None.", "");
  for (const m of r.safeMerges) {
    lines.push(
      `### ${m.brand} ${m.model}: ${[m.survivor.years, ...m.members.map((x) => x.years)].join(", ")} → ${m.toYears}`,
      "",
      m.kind === "template_copy"
        ? "*Seed-template copies — identical approximate rows from one hand-entered template. The merged row stays Approximate.*"
        : "*Sourced/verified rows, every part identical, full fit-critical evidence, identical verification.*",
      "",
      `- Survivor (keeps its id; span would become ${m.toYears}): \`${m.survivor.id}\` — ${m.survivor.years}, ${m.survivor.specStatus}, ${m.survivor.parts} parts (${m.survivor.verifiedParts} verified)`,
      ...m.members.map(
        (x) =>
          `- Kept and marked merged: \`${x.id}\` — ${x.years}, ${x.specStatus}, ${x.parts} parts (${x.verifiedParts} verified)`
      ),
      `- Affected: ${refsText(m.affected)}`,
      ...(m.affected.jobIds.length > 0 ? [`- Jobs: ${m.affected.jobIds.map((id) => `\`${id}\``).join(", ")}`] : []),
      `- Compared: ${m.comparisons.map((c) => `${c.years.join("→")}: ${c.same} of ${c.partsCompared} parts identical`).join("; ")}`,
      ""
    );
  }

  lines.push("## 2. Needs review", "");
  if (r.needsReview.length === 0 && r.similarNames.length === 0 && r.undatedRows.length === 0) {
    lines.push("None.", "");
  }
  for (const p of r.needsReview) {
    lines.push(
      `### ${p.brand} ${p.model}: ${p.years.join(" and ")}`,
      "",
      ...p.reasons.map((reason) => `- ${reason}`),
      ...p.rowsDetail.map((d) => `- \`${d.id}\` (${d.years}, ${d.specStatus}): ${refsText(d.references)}`),
      `- ${p.same} of ${p.partsCompared} listed parts identical`,
      "",
      ...differencesTable(p.differences, p.years),
      ""
    );
  }
  if (r.similarNames.length > 0) {
    lines.push("### Similar model names", "", "Same brand, names that differ only in spacing or punctuation — maybe one bike typed two ways. Never merged automatically.", "");
    for (const s of r.similarNames) {
      lines.push(`- ${s.brandName}: ${s.models.map((m) => `“${m}”`).join(", ")} — ${refsText(s.references)}`);
    }
    lines.push("");
  }
  if (r.undatedRows.length > 0) {
    lines.push("### Undated rows", "", "No year, so they can't be placed in a span. Never merged.", "");
    for (const u of r.undatedRows) lines.push(`- \`${u.id}\` (${u.specStatus}): ${refsText(u.references)}`);
    lines.push("");
  }

  lines.push("## 3. Must stay separate", "");
  if (r.keptSeparate.length === 0) lines.push("None.", "");
  for (const p of r.keptSeparate) {
    lines.push(
      `### ${p.brand} ${p.model}: ${p.years.join(" and ")}`,
      "",
      ...p.reasons.map((reason) => `- ${reason}`),
      "",
      ...differencesTable(p.differences, p.years),
      ""
    );
  }

  lines.push(
    "## Appendix: proposed soft merge (not implemented)",
    "",
    "If approved, a separate apply step would — inside one transaction, after re-checking the plan fingerprint:",
    "",
    "1. Widen the survivor's year span to the merged span. Its parts, sources and verification are unchanged; criteria above guarantee they're identical across the merged years.",
    "2. Mark each other row `mergedIntoId = survivor` (plus `mergedAt`, `mergedBy`, batch id). Nothing is deleted; every row keeps its id, parts, source URLs and verification records.",
    "3. Record the batch (who approved it, the fingerprint, and each survivor's previous span) so it can be reverted exactly.",
    "",
    "Effect on existing references:",
    "",
    "- **Job bikes** linked to a merged row keep that link and keep showing exactly the build sheet they were matched to, with a note that it's part of a wider span. Nothing is re-pointed.",
    "- **Customer bikes** with a confirmed build on a merged row keep it; the next visit still links to that same row (it's the same build, same years).",
    "- **Lookup records** listing a merged row resolve to the survivor when a new job is linked.",
    "- **New matches** see only survivors (merged rows are excluded from matching), so a 2019 bike matches the 2018–2020 survivor.",
    "- **Revert:** clear `mergedIntoId` on the batch's rows and restore each survivor's previous span from the batch record. Because nothing was deleted or re-pointed, that restores the catalog exactly.",
    ""
  );
  return lines.join("\n");
}
