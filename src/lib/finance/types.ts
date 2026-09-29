// The fields the calculations need, named as in the database
// (supabase/migrations/*_core_schema.sql). Amounts are paise.

export type AccountType = "bank" | "credit_card" | "wallet" | "savings" | "loan" | "deposit";

export type Account = {
  id: string;
  type: AccountType;
  opening_balance: number;
  // Only the insights that need these read them (INS-03, INS-11).
  is_emergency_fund?: boolean;
  // A bank or wallet account set aside for a known cost, like a sinking fund
  // (TD-18). Stored as accounts.is_blocked.
  is_blocked?: boolean;
  statement_day?: number | null;
  due_day?: number | null;
};

export type TransactionKind = "expense" | "income" | "refund" | "transfer" | "adjustment";

export type Transaction = {
  id: string;
  kind: TransactionKind;
  occurred_at: string;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  is_planned: boolean;
  bucket_override_id: string | null;
  // Only recurring commitments and their insights read these (FR-6, INS-09).
  note?: string | null;
  recurring_id?: string | null;
  // The fund it was paid from or went back to (TD-21).
  fund_id?: string | null;
};

export type BudgetBucket = {
  id: string;
  name: string;
  share_bp: number;
  holds_savings: boolean;
};

// A recurring commitment (FR-6). Its due dates are worked out from the
// schedule, not stored (TD-13).
export type Commitment = {
  id: string;
  kind: "expense" | "transfer";
  // Expected amount. For a variable bill it's an estimate.
  amount: number;
  is_variable: boolean;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  // Due every `every` `unit`s from first_due_on, until ends_on if set.
  unit: "week" | "month" | "year";
  every: number;
  first_due_on: string;
  ends_on: string | null;
  paused_at: string | null;
  // Due dates the owner skipped (recurring_skips). They drop out of the
  // schedule, so they're neither pending nor reserved.
  skipped_on: string[];
};

export type Tag = {
  id: string;
  starts_on: string | null;
  ends_on: string | null;
};
