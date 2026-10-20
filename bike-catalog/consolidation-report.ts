#!/usr/bin/env npx ts-node
/**
 * Read-only consolidation report for the bike catalog.
 *
 *   npm run catalog:report                      # writes bike-catalog/reports/…md and …json
 *   npm run catalog:report -- --out /some/dir
 *
 * Rows already merged by catalog:merge are left out, so a re-run after a merge
 * proposes only what's left. Reads the catalog (bike_catalog schema) and the shop references to it (job
 * bikes, customer bikes) inside READ ONLY transactions — Postgres itself
 * rejects any write — and writes a Markdown review and a JSON plan to disk.
 * It never merges, deletes or updates anything. Which database it reads comes
 * from CATALOG_DATABASE_URL / DATABASE_URL, and is printed first.
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { catalogPrisma, isCatalogConfigured } from "./lib/db";
import { analyzeConsolidation, type ConsolidationRow } from "./lib/consolidation";
import { loadConsolidationRows } from "./lib/consolidation-rows";
import { buildConsolidationReport, type ReportMeta, type RowReferences } from "./lib/consolidation-report";

/** Documented in .env.example; the env var wins when set. */
const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || "nshrozsfixyeihthjxxi";
const READ_TIMEOUT_MS = 120_000;

export function describeDatabase(url: string | undefined): ReportMeta["database"] {
  if (!url) return { host: "(not set)", projectRef: null, environment: "unknown" };
  try {
    const u = new URL(url);
    // Supabase pooler usernames look like postgres.<project-ref>.
    const projectRef = u.username.includes(".") ? u.username.split(".").slice(1).join(".") : null;
    const environment =
      url.includes(PRODUCTION_REF) ? "production" : projectRef ? "staging" : "unknown";
    return { host: u.hostname, projectRef, environment };
  } catch {
    return { host: "(unparseable)", projectRef: null, environment: "unknown" };
  }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Run the report and write it to `outDir`. Read-only against both databases. */
export async function runConsolidationReport(options: { outDir: string; quiet?: boolean }) {
  const log = options.quiet ? () => {} : console.log;
  if (!isCatalogConfigured()) throw new Error("CATALOG_DATABASE_URL or DATABASE_URL must be set");
  const catalogDb = describeDatabase(process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL);
  const appDb = describeDatabase(process.env.DATABASE_URL);
  log(`Reading catalog from ${catalogDb.environment} (${catalogDb.host}, ${catalogDb.projectRef ?? "?"})`);
  log(`Reading job/customer references from ${appDb.environment} (${appDb.host}, ${appDb.projectRef ?? "?"})`);
  if (catalogDb.projectRef !== appDb.projectRef) {
    console.warn("Warning: catalog and shop data come from different databases — references may not line up.");
  }

  const app = new PrismaClient();
  try {
    const rows: ConsolidationRow[] = await catalogPrisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return loadConsolidationRows(tx);
      },
      { timeout: READ_TIMEOUT_MS, maxWait: 20_000 }
    );

    const ids = rows.map((r) => r.id);
    const lookups = await catalogPrisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return tx.catalogLookup.findMany({ select: { key: true, catalogBikeIds: true } });
      },
      { timeout: READ_TIMEOUT_MS, maxWait: 20_000 }
    );

    const { jobBikes, bikes } = await app.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return {
          jobBikes: await tx.jobBike.findMany({
            where: { catalogBikeId: { in: ids } },
            select: { id: true, jobId: true, catalogBikeId: true, job: { select: { stage: true } } },
          }),
          bikes: await tx.bike.findMany({
            where: { catalogBikeId: { in: ids } },
            select: { id: true, catalogBikeId: true, catalogConfirmedAt: true },
          }),
        };
      },
      { timeout: READ_TIMEOUT_MS, maxWait: 20_000 }
    );

    const refs = new Map<string, RowReferences>(ids.map((id) => [id, { jobBikes: [], customerBikes: [], lookupKeys: [] }]));
    for (const jb of jobBikes) {
      refs.get(jb.catalogBikeId!)?.jobBikes.push({ jobBikeId: jb.id, jobId: jb.jobId, stage: jb.job.stage });
    }
    for (const b of bikes) {
      refs.get(b.catalogBikeId!)?.customerBikes.push({ bikeId: b.id, confirmed: b.catalogConfirmedAt != null });
    }
    for (const l of lookups) {
      for (const id of l.catalogBikeIds) refs.get(id)?.lookupKeys.push(l.key);
    }

    const generatedAt = new Date();
    const report = buildConsolidationReport(rows, analyzeConsolidation(rows), refs, {
      generatedAt,
      database: catalogDb,
    });

    const outDir = path.resolve(options.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = generatedAt.toISOString().replace(/[:.]/g, "-");
    const base = path.join(outDir, `consolidation-${catalogDb.environment}-${stamp}`);
    fs.writeFileSync(`${base}.md`, report.markdown);
    fs.writeFileSync(`${base}.json`, JSON.stringify(report.json, null, 2));

    const s = report.json.summary;
    log(
      `\n${s.catalogRows} rows · ${s.safeMerges} safe merge(s) · ${s.templateCopyMerges} seed-template merge(s) · ` +
        `${s.pairsNeedingReview} pair(s) to review · ${s.pairsKeptSeparate} kept separate · ` +
        `${s.similarNamesNeedingReview} similar name(s) · ${s.undatedRows} undated`
    );
    log(`Plan fingerprint ${report.json.plan.hash}`);
    log(`Wrote ${base}.md\n      ${base}.json\nNothing in either database was changed.`);
    return { report, files: { markdown: `${base}.md`, json: `${base}.json` } };
  } finally {
    await app.$disconnect();
  }
}

async function main() {
  await runConsolidationReport({ outDir: argValue("--out") ?? path.join(__dirname, "reports") });
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await catalogPrisma.$disconnect();
    });
}
