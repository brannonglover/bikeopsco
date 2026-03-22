export function parseCSVLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/** Detect delimiter from first line: comma, semicolon, or tab */
function detectDelimiter(firstLine: string): string {
  const counts = [
    { delim: ",", count: (firstLine.match(/,/g) ?? []).length },
    { delim: ";", count: (firstLine.match(/;/g) ?? []).length },
    { delim: "\t", count: (firstLine.match(/\t/g) ?? []).length },
  ];
  const best = counts.reduce((a, b) => (a.count > b.count ? a : b));
  return best.count > 0 ? best.delim : ",";
}

export function parseCSVToRows(text: string, delimiter?: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delim = delimiter ?? (lines[0] ? detectDelimiter(lines[0]) : ",");
  return lines.map((line) => parseCSVLine(line, delim));
}

export type ParseResult = {
  headers: string[];
  dataRows: string[][];
  rowOffset: number; // 1-based row number where data starts
};

export function parseCSV(text: string, firstRowIsHeader: boolean): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = lines[0] ? detectDelimiter(lines[0]) : ",";
  const rows = lines.map((line) => parseCSVLine(line, delimiter));
  if (rows.length === 0) return { headers: [], dataRows: [], rowOffset: 1 };

  const maxCols = Math.max(...rows.map((r) => r.length));
  const makeHeaders = (row: string[]) =>
    Array.from({ length: maxCols }, (_, i) => {
      const val = (row[i] ?? "").trim();
      return val || `Column ${i + 1}`;
    });

  if (firstRowIsHeader) {
    const headers = makeHeaders(rows[0]);
    const dataRows = rows.slice(1);
    return { headers, dataRows, rowOffset: 2 };
  }
  const headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  return { headers, dataRows: rows, rowOffset: 1 };
}

export type ColumnMapping = {
  nameColumn: number;
  descriptionColumn: number | null;
  priceColumn: number;
};

export function applyMapping(
  row: string[],
  mapping: ColumnMapping
): { name: string; description: string | null; price: string } {
  const name = (row[mapping.nameColumn] ?? "").trim();
  const description =
    mapping.descriptionColumn != null && mapping.descriptionColumn >= 0
      ? (row[mapping.descriptionColumn] ?? "").trim() || null
      : null;
  const priceStr = (row[mapping.priceColumn] ?? "").trim();
  return { name, description, price: priceStr };
}

export type CustomerColumnMapping = {
  firstNameColumn: number;
  lastNameColumn: number | null;
  emailColumn: number | null;
  phoneColumn: number | null;
  addressColumn: number | null;
  notesColumn: number | null;
};

export function applyCustomerMapping(
  row: string[],
  mapping: CustomerColumnMapping
): {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
} {
  const getCol = (col: number | null | undefined) => {
    if (col == null || col < 0) return null;
    const raw = row[col];
    if (raw === undefined || raw === null) return null;
    const s = String(raw).replace(/^\uFEFF/, "").trim(); // strip BOM
    return s || null;
  };
  const firstName = getCol(mapping.firstNameColumn) ?? "";
  const lastName = getCol(mapping.lastNameColumn);
  return {
    firstName,
    lastName,
    email: getCol(mapping.emailColumn),
    phone: getCol(mapping.phoneColumn),
    address: getCol(mapping.addressColumn),
    notes: getCol(mapping.notesColumn),
  };
}
