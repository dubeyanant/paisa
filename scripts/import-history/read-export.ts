// Reads the old money-manager app's export (BRD FR-14.1) into plain rows.

import * as XLSX from "xlsx";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
// Excel's day 0, as spreadsheets count it (this absorbs Excel's 1900 leap-year bug).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export type ExportType = "Expense" | "Income" | "Transfer-Out" | "Transfer-In";

export type ExportRow = {
  // 1-based row number in the sheet, for messages.
  line: number;
  // The spreadsheet date number, kept as-is for the import key.
  serial: number;
  occurredAt: Date;
  account: string;
  // For transfers, the destination account's name (FR-14.1).
  category: string;
  subcategory: string;
  note: string;
  description: string;
  // Paise, positive.
  amount: number;
  type: ExportType;
};

export type ReadResult = { rows: ExportRow[]; unreadable: { line: number; reason: string }[] };

// A spreadsheet date number is an IST wall-clock time: 46297.967082 is
// 2 Oct 2026, 23:12 IST.
export function serialToMoment(serial: number): Date {
  const wallClockMs = Math.round(serial * 86400) * 1000;
  return new Date(EXCEL_EPOCH_MS + wallClockMs - IST_OFFSET_MS);
}

// Drops the emoji the old app puts before names ("🍜 Food" -> "Food"). Some
// emoji arrive garbled as another character ("律 Health"), so any first word
// without an English letter goes.
export function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const [first, ...rest] = trimmed.split(" ");
  return rest.length > 0 && !/[A-Za-z]/.test(first) ? rest.join(" ") : trimmed;
}

// Rupees as the sheet stores them (a number, maybe with float noise) -> paise.
function toPaise(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

const TYPES: ExportType[] = ["Expense", "Income", "Transfer-Out", "Transfer-In"];
const EXPECTED_HEADER = ["Date", "Account", "Category", "Subcategory", "Note", "INR", "Income/Expense", "Description"];

export function readExport(file: ArrayBuffer | Uint8Array): ReadResult {
  const workbook = XLSX.read(file, { type: "array" });
  const sheet = workbook.Sheets["Money Manager"] ?? workbook.Sheets[workbook.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

  const header = (table[0] ?? []).map((h) => String(h).trim());
  const missing = EXPECTED_HEADER.filter((h, i) => header[i] !== h);
  if (missing.length > 0) {
    throw new Error(`Unexpected columns. Expected ${EXPECTED_HEADER.join(", ")}; got ${header.join(", ")}`);
  }

  const rows: ExportRow[] = [];
  const unreadable: ReadResult["unreadable"] = [];
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => String(c).trim() === "")) return;
    const [date, account, category, subcategory, note, inr, type, description] = cells;

    const serial = typeof date === "number" ? date : Number(date);
    if (!Number.isFinite(serial) || serial <= 0) return unreadable.push({ line, reason: `bad date "${date}"` });
    if (!TYPES.includes(type as ExportType)) return unreadable.push({ line, reason: `unknown type "${type}"` });
    const amount = toPaise(inr);
    if (amount === null) return unreadable.push({ line, reason: `bad amount "${inr}"` });
    if (!String(account).trim()) return unreadable.push({ line, reason: "no account" });

    rows.push({
      line,
      serial,
      occurredAt: serialToMoment(serial),
      account: String(account).trim(),
      category: String(category).trim(),
      subcategory: String(subcategory).trim(),
      note: String(note).trim(),
      description: String(description).trim(),
      amount,
      type: type as ExportType,
    });
  });
  return { rows, unreadable };
}
