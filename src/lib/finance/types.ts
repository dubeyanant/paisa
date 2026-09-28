// The fields the calculations need, named as in the database
// (supabase/migrations/*_core_schema.sql). Amounts are paise.

export type AccountType = "bank" | "credit_card" | "wallet" | "savings" | "loan" | "deposit";

export type Account = {
  id: string;
  type: AccountType;
  opening_balance: number;
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
};

export type BudgetBucket = {
  id: string;
  name: string;
  share_bp: number;
  holds_savings: boolean;
};
