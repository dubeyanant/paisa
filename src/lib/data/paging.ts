import "server-only";
import type { Transaction } from "@/lib/finance/types";

// Every field the calculations in src/lib/finance/ read from a transaction.
export const TRANSACTION_COLUMNS =
  "id, kind, occurred_at, amount, account_id, to_account_id, subcategory_id, is_planned, bucket_override_id, note, recurring_id";

// The API returns at most 1,000 rows a request, so longer lists come in pages.
const PAGE = 1000;
const MAX_PAGES = 10;

// `page` fetches rows `from` to `to`, in a fixed order.
export async function allRows(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: Error | null }>,
): Promise<Transaction[]> {
  const rows: Transaction[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const { data, error } = await page(n * PAGE, (n + 1) * PAGE - 1);
    if (error) throw error;
    rows.push(...(data as Record<string, unknown>[]).map(toTransaction));
    if (data!.length < PAGE) break;
  }
  return rows;
}

function toTransaction(row: Record<string, unknown>): Transaction {
  return { ...(row as Transaction), amount: Number(row.amount) };
}

