// Money is always a whole number of paise (TD-8). Rupees exist only on screen.

const groupRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

type FormatOptions = {
  // "auto" hides ".00" on whole rupees (₹120), "always" never does (₹120.00).
  paise?: "auto" | "always";
};

// Formats paise as rupees with Indian grouping: 12345678 -> "₹1,23,456.78".
// Works on integers only, so no floating-point rounding can creep in.
export function formatINR(paise: number, { paise: showPaise = "auto" }: FormatOptions = {}) {
  assertPaise(paise);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = groupRupees.format(Math.floor(abs / 100));
  const rest = abs % 100;
  const fraction =
    rest === 0 && showPaise === "auto" ? "" : `.${String(rest).padStart(2, "0")}`;
  return `${sign}₹${rupees}${fraction}`;
}

// Parses what the owner types ("120", "1,23,456.78", "₹99.5") into paise.
// Returns null for anything that isn't a non-negative amount with at most
// two decimal places.
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function assertPaise(value: number) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Expected a whole number of paise, got ${value}`);
  }
}

// Like parseRupees, but also accepts a leading minus ("-1,250"), for balances
// that can go below zero.
export function parseSignedRupees(input: string): number | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const paise = parseRupees(negative ? trimmed.slice(1) : trimmed);
  if (paise === null) return null;
  return negative ? 0 - paise : paise; // not -paise, which turns 0 into -0
}

// Paise as a plain number to put in an input field: 1250000 -> "12500",
// 12050 -> "120.50". No ₹ sign or grouping, so it parses back unchanged.
export function toRupeesInput(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rest = abs % 100;
  return `${sign}${Math.floor(abs / 100)}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}
