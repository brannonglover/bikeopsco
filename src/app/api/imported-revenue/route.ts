import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseImportedRevenueCSV,
  type ParsedImportRow,
} from "@/lib/imported-revenue-csv";

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
    if (!(file instanceof File)) {
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

  for (const row of rows) {
    const amount = new Prisma.Decimal(String(row.amount));
    const base = {
      source,
      occurredAt: row.occurredAt,
      amount,
      description: row.description ?? null,
    };

    if (row.externalId) {
      const existing = await prisma.importedRevenue.findUnique({
        where: { externalId: row.externalId },
      });
      await prisma.importedRevenue.upsert({
        where: { externalId: row.externalId },
        create: { ...base, externalId: row.externalId },
        update: {
          amount,
          occurredAt: row.occurredAt,
          description: base.description,
          source,
        },
      });
      if (existing) upserted++;
      else created++;
    } else {
      await prisma.importedRevenue.create({ data: base });
      created++;
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
