import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseCSV } from "@/lib/import-parser";

export const runtime = "nodejs";

function parseExcelToRows(buffer: ArrayBuffer): string[][] {
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rawRows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return rawRows
    .filter((row): row is (string | number)[] => Array.isArray(row))
    .map((row) =>
      row.map((cell) => (cell != null && cell !== "" ? String(cell).trim() : ""))
    );
}

function excelToParseResult(rows: string[][], firstRowIsHeader: boolean): {
  headers: string[];
  dataRows: string[][];
  rowOffset: number;
} {
  if (rows.length === 0) return { headers: [], dataRows: [], rowOffset: 1 };
  const maxCols = Math.max(...rows.map((r) => r.length));
  const makeHeaders = (row: string[]) =>
    Array.from({ length: maxCols }, (_, i) => {
      const val = (row[i] ?? "").trim();
      return val || `Column ${i + 1}`;
    });
  if (firstRowIsHeader) {
    const headers = makeHeaders(rows[0]);
    return { headers, dataRows: rows.slice(1), rowOffset: 2 };
  }
  const headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  return { headers, dataRows: rows, rowOffset: 1 };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const firstRowIsHeader = formData.get("firstRowIsHeader") !== "false";

    if (!file || typeof file === "string" || !("name" in file) || !("arrayBuffer" in file)) {
      return NextResponse.json(
        { error: "No file provided." },
        { status: 400 }
      );
    }

    const ext = (file as { name: string }).name.toLowerCase().slice(-5);
    const ext4 = (file as { name: string }).name.toLowerCase().slice(-4);
    const isExcel = ext === ".xlsx" || ext4 === ".xls";
    const isCsv = ext4 === ".csv";

    if (!isCsv && !isExcel) {
      return NextResponse.json(
        { error: "File must be CSV or Excel (.xlsx, .xls)." },
        { status: 400 }
      );
    }

    let result: { headers: string[]; dataRows: string[][]; rowOffset: number };

    if (isExcel) {
      const buffer = await (file as Blob).arrayBuffer();
      const rows = parseExcelToRows(buffer);
      if (rows.length === 0) {
        return NextResponse.json({ error: "Excel file is empty." }, { status: 400 });
      }
      result = excelToParseResult(rows, firstRowIsHeader);
    } else {
      const text = await (file as Blob).text();
      result = parseCSV(text, firstRowIsHeader);
    }

    if (result.dataRows.length === 0) {
      return NextResponse.json(
        { error: "No data rows found." },
        { status: 400 }
      );
    }

    const sampleRows = result.dataRows.slice(0, 5);
    return NextResponse.json({
      headers: result.headers,
      sampleRows,
      rowCount: result.dataRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("POST /api/products/import/preview error:", message);
    return NextResponse.json(
      {
        error: "Failed to preview file.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
