import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseImportedRevenueCSV,
  type ParsedImportRow,
} from "@/lib/imported-revenue-csv";

/** Serverless timeout (e.g. Vercel Pro). Hobby max is 10s — large imports may still need a smaller CSV. */
export const maxDuration = 60;

const CREATE_CHUNK = 800;
const UPSERT_CHUNK = 40;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ct = request.headers.get("content-type") ?? "";
  let source = "SQUARE";
  const parseWarnings: string[] = [];
  let rows: ParsedImportRow[] = [];

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const src = form.get("source");
    if (typeof src === "string" && src.trim()) source = src.trim().slice(0, 64);
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing CSV file (field name: file)." }, { status: 400 });
    }
    const text = await file.text();
    const parsed = parseImportedRevenueCSV(text);
    parseWarnings.push(...parsed.errors);
    rows = parsed.rows;
  } else if (ct.includes("application/json")) {
    const body = (await request.json()) as {
      source?: string;
      rows?: Array<{
        occurredAt: string;
        amount: number;
        description?: string;
        externalId?: string;
      }>;
    };
    if (typeof body.source === "string" && body.source.trim()) {
      source = body.source.trim().slice(0, 64);
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "JSON body needs a non-empty rows array." }, { status: 400 });
    }
    for (let i = 0; i < body.rows.length; i++) {
      const r = body.rows[i];
      const d = new Date(r.occurredAt);
      if (!Number.isFinite(d.getTime())) {
        parseWarnings.push(`Row ${i + 1}: invalid occurredAt`);
        continue;
      }
      if (typeof r.amount !== "number" || !Number.isFinite(r.amount)) {
        parseWarnings.push(`Row ${i + 1}: invalid amount`);
        continue;
      }
      rows.push({
        occurredAt: d,
        amount: r.amount,
        description: r.description,
        externalId: r.externalId,
      });
    }
  } else {
    return NextResponse.json(
      { error: "Send multipart/form-data with a CSV file, or application/json with rows." },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error: "No valid rows to import.",
        warnings: parseWarnings,
      },
      { status: 400 }
    );
  }

  let created = 0;
  let upserted = 0;

  const withoutId: Prisma.ImportedRevenueCreateManyInput[] = [];
  const withId: ParsedImportRow[] = [];

  for (const row of rows) {
    const amount = new Prisma.Decimal(String(row.amount));
    const base = {
      source,
      occurredAt: row.occurredAt,
      amount,
      description: row.description ?? null,
    };
    if (row.externalId) {
      withId.push(row);
    } else {
      withoutId.push(base);
    }
  }

  for (let i = 0; i < withoutId.length; i += CREATE_CHUNK) {
    const chunk = withoutId.slice(i, i + CREATE_CHUNK);
    const result = await prisma.importedRevenue.createMany({ data: chunk });
    created += result.count;
  }

  for (let i = 0; i < withId.length; i += UPSERT_CHUNK) {
    const chunk = withId.slice(i, i + UPSERT_CHUNK);
    const ids = chunk.map((r) => r.externalId!);
    const existing = await prisma.importedRevenue.findMany({
      where: { externalId: { in: ids } },
      select: { externalId: true },
    });
    const existingSet = new Set(
      existing.map((e) => e.externalId).filter((x): x is string => x != null)
    );

    await prisma.$transaction(
      chunk.map((row) => {
        const amount = new Prisma.Decimal(String(row.amount));
        const base = {
          source,
          occurredAt: row.occurredAt,
          amount,
          description: row.description ?? null,
        };
        return prisma.importedRevenue.upsert({
          where: { externalId: row.externalId! },
          create: { ...base, externalId: row.externalId! },
          update: {
            amount,
            occurredAt: row.occurredAt,
            description: base.description,
            source,
          },
        });
      })
    );

    for (const row of chunk) {
      if (existingSet.has(row.externalId!)) upserted++;
      else created++;
    }
  }

  return NextResponse.json({
    ok: true,
    source,
    created,
    updated: upserted,
    processed: rows.length,
    warnings: parseWarnings.length ? parseWarnings : undefined,
  });
}
