import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { coerceCustomerPhone } from "@/lib/phone";
import {
  parseCSV,
  applyCustomerMapping,
  type CustomerColumnMapping,
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

    const mapping: CustomerColumnMapping = mappingStr
      ? (JSON.parse(mappingStr) as CustomerColumnMapping)
      : {
          firstNameColumn: 0,
          lastNameColumn: 1,
          emailColumn: 2,
          phoneColumn: 3,
          addressColumn: 4,
          notesColumn: 5,
        };

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
    let headers: string[];

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
      headers = result.headers;
    } else {
      const text = await (file as Blob).text();
      const result = parseCSV(text, firstRowIsHeader);
      dataRows = result.dataRows;
      rowOffset = result.rowOffset;
      headers = result.headers;
    }

    if (dataRows.length === 0) {
      return NextResponse.json(
        {
          error: "No data rows found. Make sure 'First row contains column headers' is set correctly for your file.",
          created: 0,
        },
        { status: 400 }
      );
    }

    const created: { firstName: string; lastName: string | null }[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = rowOffset + i;

      const { firstName, lastName, email, phone, address, notes } =
        applyCustomerMapping(row, mapping);

      if (!firstName) {
        const rawValue = row[mapping.firstNameColumn];
        const hint =
          rawValue === undefined || rawValue === ""
            ? ` (column index ${mapping.firstNameColumn} was empty or missing)`
            : ` (column had: "${String(rawValue).slice(0, 50)}")`;
        errors.push({
          row: rowNum,
          message: `First name is required${hint}`,
        });
        continue;
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: rowNum, message: `Invalid email: ${email}` });
        continue;
      }

      try {
        const customer = await prisma.customer.create({
          data: {
            shopId: shop.id,
            firstName,
            lastName,
            email,
            phone: coerceCustomerPhone(phone),
            address,
            notes,
          },
        });
        created.push({
          firstName: customer.firstName,
          lastName: customer.lastName,
        });
      } catch (err) {
        const displayName = lastName ? `${firstName} ${lastName}` : firstName;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({
          row: rowNum,
          message: `Failed to create "${displayName}"${errMsg ? `: ${errMsg}` : ""}`,
        });
      }
    }

    return NextResponse.json({
      created: created.length,
      totalRows: dataRows.length,
      errors: errors.length > 0 ? errors : undefined,
      customers: created,
      // When import fails, show headers + first data row so user can fix mapping
      debug:
        created.length === 0 && dataRows.length > 0
          ? (() => {
              const firstParsed = applyCustomerMapping(dataRows[0], mapping);
              return {
                headers: headers.map((h, i) => ({ col: i, name: h || `(empty)` })),
                firstRow: dataRows[0].map((val, i) => ({
                  col: i,
                  header: headers[i] || `Column ${i + 1}`,
                  value: val,
                })),
                mapping: {
                  firstNameColumn: mapping.firstNameColumn,
                  lastNameColumn: mapping.lastNameColumn,
                },
                parsedFromFirstRow: {
                  firstName: firstParsed.firstName || "(empty)",
                  lastName: firstParsed.lastName,
                },
              };
            })()
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("POST /api/customers/import error:", message, stack);
    return NextResponse.json(
      {
        error: "Import failed. Check file format and try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
