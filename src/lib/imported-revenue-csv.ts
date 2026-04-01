/**
 * Parse Square (and similar) transaction CSV exports for imported revenue.
 * Detects common column names for date, amount, and optional payment id.
 */

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase();
}

const DATE_HEADERS = [
  "date",
  "transaction date",
  "payment date",
  "created date",
];

const AMOUNT_HEADERS = [
  "amount",
  "gross sales",
  "net sales",
  "payment amount",
  "sales",
  "total",
  "collected",
];

const ID_HEADERS = ["payment id", "transaction id", "order id"];

function pickColumnIndex(headers: string[], candidates: string[]): number {
  const norm = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const i = norm.indexOf(cand);
    if (i >= 0) return i;
  }
  return -1;
}

function parseMoney(raw: string): number | null {
  const s = raw.replace(/[$£€]/g, "").replace(/,/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse MM/DD/YYYY or YYYY-MM-DD or ISO-ish strings to UTC noon to avoid TZ drift. */
function parseOccurredAt(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;

  const iso = /^\d{4}-\d{2}-\d{2}/.exec(t);
  if (iso) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (mdy) {
    const month = Number.parseInt(mdy[1], 10) - 1;
    const day = Number.parseInt(mdy[2], 10);
    const year = Number.parseInt(mdy[3], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ParsedImportRow = {
  occurredAt: Date;
  amount: number;
  description?: string;
  externalId?: string;
};

export function parseImportedRevenueCSV(text: string): {
  rows: ParsedImportRow[];
  errors: string[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV needs a header row and at least one data row."] };
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  let dateIdx = pickColumnIndex(headers, DATE_HEADERS);
  let amountIdx = pickColumnIndex(headers, AMOUNT_HEADERS);
  const idIdx = pickColumnIndex(headers, ID_HEADERS);

  if (dateIdx < 0 && headers.length >= 2) dateIdx = 0;
  if (amountIdx < 0 && headers.length >= 2) amountIdx = 1;

  if (dateIdx < 0 || amountIdx < 0) {
    return {
      rows: [],
      errors: [
        "Could not find Date and Amount columns. Use headers like Date and Amount, or Gross Sales / Net Sales.",
      ],
    };
  }

  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const dateRaw = cells[dateIdx] ?? "";
    const amountRaw = cells[amountIdx] ?? "";
    const occurredAt = parseOccurredAt(dateRaw);
    const amount = parseMoney(amountRaw);

    if (!occurredAt) {
      errors.push(`Row ${i + 1}: bad date "${dateRaw}"`);
      continue;
    }
    if (amount === null) {
      errors.push(`Row ${i + 1}: bad amount "${amountRaw}"`);
      continue;
    }

    const externalId =
      idIdx >= 0 && cells[idIdx]?.trim() ? cells[idIdx].trim() : undefined;

    rows.push({
      occurredAt,
      amount,
      externalId,
      description: headers.length ? `CSV row ${i + 1}` : undefined,
    });
  }

  return { rows, errors };
}
