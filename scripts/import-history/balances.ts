// Last import step (FR-14.2 step 6): match each account to its real balance today.
//
//   bun scripts/import-history/balances.ts          first run: writes .private/balances.ts to fill in
//                                                   later runs: shows computed vs actual
//   bun scripts/import-history/balances.ts --write  records one adjustment per account that differs
//
// Adjustments belong to the latest import batch, so undoing the import removes
// them too, and no insight ever counts them (BR-13).

import { createClient } from "@supabase/supabase-js";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountBalances } from "../../src/lib/finance/balances";
import { formatINR, parseRupees } from "../../src/lib/finance/money";
import type { Account, Transaction } from "../../src/lib/finance/types";

const PRIVATE_DIR = join(import.meta.dir, "..", "..", ".private");
const BALANCES_FILE = join(PRIVATE_DIR, "balances.ts");
// Accounts whose balance is shown as an amount owed.
const OWED = new Set(["credit_card", "loan"]);

type Entry = string | { balance: string; archive?: boolean };

async function main() {
  const write = process.argv.includes("--write");
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } = process.env;
  const supabase = createClient(url!, key!, { auth: { persistSession: false } });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: process.env.PAISA_EMAIL!,
    password: process.env.PAISA_PASSWORD!,
  });
  if (signInError) throw new Error(`Sign-in failed: ${signInError.code ?? signInError.message}`);

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name, type, opening_balance, archived_at")
    .order("name");
  if (error) throw error;
  const transactions: Transaction[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: txError } = await supabase
      .from("transactions")
      .select("id, kind, occurred_at, amount, account_id, to_account_id, subcategory_id, is_planned, bucket_override_id")
      .order("id")
      .range(from, from + 999);
    if (txError) throw txError;
    transactions.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const computed = accountBalances(accounts as Account[], transactions, new Date());
  const shown = (a: { id: string; type: string }) => (OWED.has(a.type) ? 0 - computed.get(a.id)! : computed.get(a.id)!);

  if (!existsSync(BALANCES_FILE)) {
    const lines = accounts.map(
      (a) => `  ${JSON.stringify(a.name)}: ${JSON.stringify(formatINR(shown(a), { paise: "always" }).replace("₹", ""))}, // ${a.type}`,
    );
    writeFileSync(
      BALANCES_FILE,
      [
        "// Today's real balance for each account. Private: git-ignored (TD-6).",
        "// Prefilled with what the imported history adds up to; change what's different.",
        "// Credit cards and loans: the amount owed, as a positive number.",
        '// To archive an account as well, write { balance: "0", archive: true }.',
        "",
        "export default {",
        ...lines,
        "};",
        "",
      ].join("\n"),
    );
    return console.log(`Wrote ${BALANCES_FILE}. Fill in today's balances, then run this again.`);
  }

  const actual: Record<string, Entry> = (await import(BALANCES_FILE)).default;
  const { data: batch } = await supabase
    .from("import_batches")
    .select("id")
    .order("imported_at", { ascending: false })
    .limit(1)
    .single();
  if (!batch) throw new Error("No import batch found. Run the import first.");

  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  let changes = 0;
  for (const account of accounts) {
    const entry = actual[account.name];
    if (entry === undefined) {
      console.log(`${account.name}: not in balances.ts, left as is`);
      continue;
    }
    const { balance, archive } = typeof entry === "string" ? { balance: entry, archive: false } : entry;
    const entered = parseRupees(balance.replace(/^-/, ""));
    if (entered === null) throw new Error(`${account.name}: can't read "${balance}"`);
    const sign = balance.trim().startsWith("-") ? -1 : 1;
    const target = OWED.has(account.type) ? -sign * entered : sign * entered;
    const difference = target - computed.get(account.id)!;

    if (difference !== 0) {
      changes++;
      console.log(`${account.name}: adjust by ${formatINR(difference, { paise: "always" })}`);
      if (write) {
        const { error: adjustError } = await supabase.from("transactions").insert({
          kind: "adjustment",
          occurred_at: new Date().toISOString(),
          amount: difference,
          account_id: account.id,
          note: "Balance adjustment after import",
          import_batch_id: batch.id,
          import_key: `balance:${account.id}:${today}`,
        });
        if (adjustError) throw adjustError;
      }
    }
    if (archive && !account.archived_at) {
      changes++;
      console.log(`${account.name}: archive`);
      if (write) await supabase.from("accounts").update({ archived_at: new Date().toISOString() }).eq("id", account.id);
    }
  }
  if (changes === 0) console.log("Every account already matches.");
  else if (!write) console.log("\nDry run: nothing was written. Add --write to record these.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
