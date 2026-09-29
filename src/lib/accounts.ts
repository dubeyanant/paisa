import { parseSignedRupees } from "@/lib/finance/money";
import type { AccountType } from "@/lib/finance/types";

// In the order the Accounts screen lists them.
export const ACCOUNT_TYPES: { type: AccountType; label: string; group: string; hint: string }[] = [
  {
    type: "bank",
    label: "Bank",
    group: "Bank accounts",
    hint: "An account you spend from, by UPI or card.",
  },
  {
    type: "wallet",
    label: "Wallet or cash",
    group: "Wallets and cash",
    hint: "Cash in hand, or a prepaid wallet.",
  },
  {
    type: "credit_card",
    label: "Credit card",
    group: "Credit cards",
    hint: "Spends count when you make them. Paying the bill is not spending.",
  },
  {
    type: "savings",
    label: "Savings or investment",
    group: "Savings and investments",
    hint: "Money moved here counts as saved, like an FD, mutual fund or shares.",
  },
  {
    type: "deposit",
    label: "Deposit",
    group: "Deposits",
    hint: "Money held elsewhere that comes back, like a rent deposit.",
  },
  {
    type: "loan",
    label: "Loan",
    group: "Loans",
    hint: "Money you owe, like an education loan.",
  },
];

export function accountTypeInfo(type: AccountType) {
  return ACCOUNT_TYPES.find((t) => t.type === type)!;
}

// Credit cards and loans hold money owed. Their balance is negative while
// something is owed, and screens show the amount owed instead (TD-13).
export function isOwedType(type: AccountType) {
  return type === "credit_card" || type === "loan";
}

// "1st", "2nd", "23rd".
export function ordinal(day: number) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"}`;
}

export type AccountInput = {
  name: string;
  type: AccountType;
  opening_balance: number;
  opening_date: string;
  statement_day: number | null;
  due_day: number | null;
  is_emergency_fund: boolean;
  is_blocked: boolean;
};

type Parsed = { ok: true; values: AccountInput } | { ok: false; error: string };

// Reads and checks the account form. For a credit card or loan the form asks
// for the amount owed, which is stored as a negative balance.
export function parseAccountForm(form: FormData): Parsed {
  const text = (key: string) => String(form.get(key) ?? "").trim();

  const name = text("name");
  if (!name) return { ok: false, error: "Give the account a name." };
  if (name.length > 60) return { ok: false, error: "Keep the name to 60 characters or fewer." };

  const type = ACCOUNT_TYPES.find((t) => t.type === text("type"))?.type;
  if (!type) return { ok: false, error: "Choose what kind of account this is." };

  const opening = text("opening_balance");
  const entered = opening === "" ? 0 : parseSignedRupees(opening);
  if (entered === null) {
    return { ok: false, error: "Enter the opening balance as an amount, like 12,500 or 120.50." };
  }

  const opening_date = text("opening_date");
  if (!isCalendarDate(opening_date)) return { ok: false, error: "Enter a valid opening date." };

  let statement_day = null;
  let due_day = null;
  if (type === "credit_card") {
    statement_day = dayOfMonth(text("statement_day"));
    due_day = dayOfMonth(text("due_day"));
    if (statement_day === undefined || due_day === undefined) {
      return { ok: false, error: "Statement and due days are days of the month, from 1 to 31." };
    }
  }

  return {
    ok: true,
    values: {
      name,
      type,
      opening_balance: isOwedType(type) ? 0 - entered : entered,
      opening_date,
      statement_day,
      due_day,
      is_emergency_fund: type === "savings" && form.get("is_emergency_fund") === "on",
      is_blocked: (type === "bank" || type === "wallet") && form.get("is_blocked") === "on",
    },
  };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// null when left empty, undefined when it isn't a day of the month.
function dayOfMonth(value: string): number | null | undefined {
  if (value === "") return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined;
}
