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
