import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import {
  parseCSV,
  applyProductMapping,
  type ProductColumnMapping,
} from "@/lib/import-parser";
import { requireCurrentShop } from "@/lib/shop";

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
      row.map((cell) =>
        cell != null && cell !== "" ? String(cell).trim() : ""
      )
    );
}

function excelToParseResult(
  rows: string[][],
  firstRowIsHeader: boolean
): { headers: string[]; dataRows: string[][]; rowOffset: number } {
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
  const errors: { row: number; message: string }[] = [];

  try {
    const shop = await requireCurrentShop();
    const formData = await request.formData();
    const file = formData.get("file");
    const mappingStr = formData.get("mapping") as string | null;
    const firstRowIsHeader = formData.get("firstRowIsHeader") !== "false";

    if (!file || typeof file === "string" || !("name" in file) || !("arrayBuffer" in file)) {
      return NextResponse.json(
        { error: "No file provided. Upload a CSV or Excel file." },
        { status: 400 }
      );
    }

    const defaultMapping: ProductColumnMapping = {
      nameColumn: 0,
      descriptionColumn: 1,
      priceColumn: 2,
      stockQuantityColumn: 3,
      supplierColumn: 4,
    };
    const mapping: ProductColumnMapping = mappingStr
      ? (JSON.parse(mappingStr) as ProductColumnMapping)
      : defaultMapping;

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

    let dataRows: string[][];
    let rowOffset: number;

    if (isExcel) {
      const buffer = await (file as Blob).arrayBuffer();
      const rows = parseExcelToRows(buffer);
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Excel file is empty." },
          { status: 400 }
        );
      }
      const result = excelToParseResult(rows, firstRowIsHeader);
      dataRows = result.dataRows;
      rowOffset = result.rowOffset;
    } else {
      const text = await (file as Blob).text();
      const result = parseCSV(text, firstRowIsHeader);
      dataRows = result.dataRows;
      rowOffset = result.rowOffset;
    }

    const created: { name: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = rowOffset + i;

      const { name, description, price: priceStr, stockQuantity: stockStr, supplier } =
        applyProductMapping(row, mapping);

      if (!name) {
        errors.push({ row: rowNum, message: "Name is required" });
        continue;
      }

      const price = parseFloat(String(priceStr).replace(/[$,]/g, ""));

      if (Number.isNaN(price) || price < 0) {
        errors.push({ row: rowNum, message: `Invalid price: ${priceStr}` });
        continue;
      }

      const stockQuantity = parseInt(String(stockStr).replace(/[^\d-]/g, ""), 10);
      const qty = Number.isNaN(stockQuantity) || stockQuantity < 0 ? 0 : stockQuantity;

      try {
        const product = await prisma.product.create({
          data: { shopId: shop.id, name, description, price, stockQuantity: qty, supplier },
        });
        created.push({ name: product.name });
      } catch {
        errors.push({ row: rowNum, message: `Failed to create "${name}"` });
      }
    }

    return NextResponse.json({
      created: created.length,
      errors: errors.length > 0 ? errors : undefined,
      products: created,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("POST /api/products/import error:", message, stack);
    return NextResponse.json(
      {
        error: "Import failed. Check file format and try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
