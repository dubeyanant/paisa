// Runs every migration on an in-memory Postgres (PGlite) with a stand-in for the
// parts of Supabase they rely on, then checks defaults, access rules and
// constraints. Preview databases are off, so without this a migration would
// first run for real in production (TD-3).
//
// PGlite is a newer Postgres major version than production (see
// supabase/config.toml), so avoid features that production doesn't have yet.

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accountBalances } from "../../src/lib/finance/balances";
import { bucketActuals } from "../../src/lib/finance/budget";
import { istStartOf, periodContains, type Period } from "../../src/lib/finance/dates";
import { periodTotals } from "../../src/lib/finance/totals";
import type { Account, BudgetBucket, Transaction } from "../../src/lib/finance/types";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

// Just enough of Supabase: the API roles, auth.users, and auth.uid() reading the
// signed-in user from the request's JWT claims.
const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const OWNER = "00000000-0000-4000-8000-000000000001"; // exists before the migrations
const OTHER = "00000000-0000-4000-8000-000000000002"; // signs up afterwards

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  await db.query("insert into auth.users (id, email) values ($1, 'owner@example.com')", [OWNER]);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  await db.query("insert into auth.users (id, email) values ($1, 'other@example.com')", [OTHER]);
});

// Runs `fn` as a signed-in user, the way PostgREST does.
async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(userId ? "set role authenticated" : "set role anon");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function makeAccount(userId: string, name: string, type = "bank") {
  const [row] = await as(userId, () =>
    rows<{ id: string }>("insert into accounts (name, type) values ($1, $2) returning id", [
      name,
      type,
    ]),
  );
  return row.id;
}

async function subcategoryId(userId: string, name: string) {
  const [row] = await rows<{ id: string }>(
    "select id from subcategories where user_id = $1 and name = $2",
    [userId, name],
  );
  return row.id;
}

describe("default data", () => {
  test.each([
    ["an account that existed before the migration", OWNER],
    ["an account created afterwards", OTHER],
  ])("%s gets the BRD §10 taxonomy", async (_label, userId) => {
    const categories = await rows<{ kind: string; n: number }>(
      "select kind, count(*)::int as n from categories where user_id = $1 group by kind order by kind",
      [userId],
    );
    expect(categories).toEqual([
      { kind: "expense", n: 8 },
      { kind: "income", n: 4 },
    ]);

    const [{ n: subs }] = await rows<{ n: number }>(
      "select count(*)::int as n from subcategories where user_id = $1 and kind = 'expense'",
      [userId],
    );
    expect(subs).toBe(36);

    const [settings] = await rows("select * from settings where user_id = $1", [userId]);
    expect(settings).toMatchObject({ budget_month_start_day: 1, small_spend_threshold: 20000 });
  });

  test("the active rule is 50/30/20 and every expense subcategory has a bucket", async () => {
    const buckets = await rows(
      `select b.name, b.share_bp, b.holds_savings
         from budget_buckets b join budget_rules r on r.id = b.rule_id
        where r.user_id = $1 and r.is_active order by b.sort_order`,
      [OWNER],
    );
    expect(buckets).toEqual([
      { name: "Needs", share_bp: 5000, holds_savings: false },
      { name: "Wants", share_bp: 3000, holds_savings: false },
      { name: "Savings", share_bp: 2000, holds_savings: true },
    ]);

    const unassigned = await rows(
      `select s.name from subcategories s
        where s.user_id = $1 and s.kind = 'expense'
          and not exists (select 1 from bucket_assignments a where a.subcategory_id = s.id)`,
      [OWNER],
    );
    expect(unassigned).toEqual([]);

    const bucketOf = async (sub: string) =>
      (
        await rows<{ name: string }>(
          `select b.name from bucket_assignments a
             join budget_buckets b on b.id = a.bucket_id
             join subcategories s on s.id = a.subcategory_id
            where s.user_id = $1 and s.name = $2`,
          [OWNER, sub],
        )
      )[0].name;
    expect(await bucketOf("Family")).toBe("Needs"); // BR-12
    expect(await bucketOf("Gym & training")).toBe("Wants"); // Q3
    expect(await bucketOf("Lost Track")).toBe("Wants");
  });
});

describe("access rules", () => {
  test("signed-out visitors can't read anything", async () => {
    await expect(as(null, () => rows("select * from categories"))).rejects.toThrow(
      /permission denied/,
    );
  });

  test("a user sees only their own rows", async () => {
    const seen = await as(OTHER, () => rows<{ user_id: string }>("select user_id from categories"));
    expect(seen.length).toBe(12);
    expect(seen.every((r) => r.user_id === OTHER)).toBe(true);
  });

  test("a user can't write rows for someone else", async () => {
    await expect(
      as(OTHER, () =>
        rows("insert into accounts (user_id, name, type) values ($1, 'Sneaky', 'bank')", [OWNER]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("a user can't point their rows at someone else's", async () => {
    const ownerAccount = await makeAccount(OWNER, "Owner Bank");
    await expect(
      as(OTHER, () =>
        rows(
          "insert into transactions (kind, occurred_at, amount, account_id) values ('adjustment', now(), 100, $1)",
          [ownerAccount],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("transactions", () => {
  let bank: string;
  let card: string;

  beforeAll(async () => {
    bank = await makeAccount(OWNER, "Test Bank");
    card = await makeAccount(OWNER, "Test Card", "credit_card");
  });

  const insert = (values: Record<string, unknown>) =>
    as(OWNER, () => {
      const cols = Object.keys(values);
      return rows(
        `insert into transactions (${cols.join(", ")})
         values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(values),
      );
    });

  test("accepts each kind with the fields it needs", async () => {
    const rickshaw = await subcategoryId(OWNER, "Rickshaw");
    const salary = await subcategoryId(OWNER, "Salary");
    const now = new Date().toISOString();
    await insert({ kind: "expense", occurred_at: now, amount: 12000, account_id: bank, subcategory_id: rickshaw });
    await insert({ kind: "refund", occurred_at: now, amount: 5000, account_id: bank, subcategory_id: rickshaw });
    await insert({ kind: "income", occurred_at: now, amount: 6000000, account_id: bank, subcategory_id: salary });
    await insert({ kind: "transfer", occurred_at: now, amount: 1234567, account_id: bank, to_account_id: card });
    await insert({ kind: "adjustment", occurred_at: now, amount: -2500, account_id: bank });
  });

  test("rejects a subcategory of the wrong kind", async () => {
    const salary = await subcategoryId(OWNER, "Salary");
    await expect(
      insert({ kind: "expense", occurred_at: new Date().toISOString(), amount: 100, account_id: bank, subcategory_id: salary }),
    ).rejects.toThrow(/foreign key/);
  });

  test.each([
    ["an expense without a subcategory", { kind: "expense", amount: 100 }],
    ["a zero amount", { kind: "adjustment", amount: 0 }],
    ["a negative expense", { kind: "expense", amount: -100 }],
    ["a transfer without a destination", { kind: "transfer", amount: 100 }],
  ])("rejects %s", async (_label, values) => {
    await expect(
      insert({ occurred_at: new Date().toISOString(), account_id: bank, ...values }),
    ).rejects.toThrow(/check constraint/);
  });

  test("accepts every account type and rejects unknown ones", async () => {
    for (const type of ["bank", "credit_card", "wallet", "savings", "loan", "deposit"]) {
      await makeAccount(OWNER, `Type ${type}`, type);
    }
    await expect(makeAccount(OWNER, "Type crypto", "crypto")).rejects.toThrow(/check constraint/);
  });

  test("a transfer can't go to the same account", async () => {
    await expect(
      insert({ kind: "transfer", occurred_at: new Date().toISOString(), amount: 100, account_id: bank, to_account_id: bank }),
    ).rejects.toThrow(/check constraint/);
  });

  test("an account with history can't be deleted", async () => {
    await expect(as(OWNER, () => rows("delete from accounts where id = $1", [bank]))).rejects.toThrow(
      /foreign key/,
    );
  });

  test("deleting an import batch removes exactly its rows", async () => {
    const [batch] = await as(OWNER, () =>
      rows<{ id: string }>("insert into import_batches (file_name) values ('made-up.xlsx') returning id"),
    );
    const eatingOut = await subcategoryId(OWNER, "Eating out");
    for (const key of ["row-1", "row-2"]) {
      await insert({ kind: "expense", occurred_at: new Date().toISOString(), amount: 15000, account_id: bank, subcategory_id: eatingOut, import_batch_id: batch.id, import_key: key });
    }
    const count = async () =>
      (await rows<{ n: number }>("select count(*)::int as n from transactions where user_id = $1", [OWNER]))[0].n;
    const before = await count();

    // The same key again is a row that was already imported.
    await expect(
      insert({ kind: "expense", occurred_at: new Date().toISOString(), amount: 15000, account_id: bank, subcategory_id: eatingOut, import_batch_id: batch.id, import_key: "row-1" }),
    ).rejects.toThrow(/duplicate key/);

    await as(OWNER, () => rows("delete from import_batches where id = $1", [batch.id]));
    expect(await count()).toBe(before - 2);
  });
});

describe("account_balances view", () => {
  const USER = "00000000-0000-4000-8000-000000000003";
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];

  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'third@example.com')", [USER]);
    for (const [name, type, opening_balance] of [
      ["Bank", "bank", 1000000],
      ["Card", "credit_card", -250000],
      ["Fund", "savings", 0],
      ["Loan", "loan", -50000000],
      ["Unused", "wallet", 70000],
    ] as const) {
      const [row] = await as(USER, () =>
        rows<{ id: string }>(
          "insert into accounts (name, type, opening_balance) values ($1, $2, $3) returning id",
          [name, type, opening_balance],
        ),
      );
      accounts.push({ id: row.id, type, opening_balance });
    }
    const [bank, card, fund, loan] = accounts.map((a) => a.id);
    const food = await subcategoryId(USER, "Groceries");
    const salary = await subcategoryId(USER, "Salary");
    const entries: Omit<Transaction, "id" | "occurred_at" | "bucket_override_id">[] = [
      { kind: "expense", amount: 12050, account_id: bank, to_account_id: null, subcategory_id: food, is_planned: false },
      { kind: "expense", amount: 99900, account_id: card, to_account_id: null, subcategory_id: food, is_planned: false },
      { kind: "refund", amount: 5000, account_id: card, to_account_id: null, subcategory_id: food, is_planned: false },
      { kind: "income", amount: 6000000, account_id: bank, to_account_id: null, subcategory_id: salary, is_planned: false },
      { kind: "transfer", amount: 1234567, account_id: bank, to_account_id: card, subcategory_id: null, is_planned: false },
      { kind: "transfer", amount: 1000000, account_id: bank, to_account_id: fund, subcategory_id: null, is_planned: false },
      { kind: "transfer", amount: 2500000, account_id: bank, to_account_id: loan, subcategory_id: null, is_planned: false },
      { kind: "adjustment", amount: -2500, account_id: bank, to_account_id: null, subcategory_id: null, is_planned: false },
      { kind: "adjustment", amount: 700, account_id: fund, to_account_id: null, subcategory_id: null, is_planned: false },
      // Planned entries don't count until confirmed (BR-7).
      { kind: "expense", amount: 1500000, account_id: bank, to_account_id: null, subcategory_id: food, is_planned: true },
      { kind: "transfer", amount: 300000, account_id: bank, to_account_id: card, subcategory_id: null, is_planned: true },
    ];
    for (const entry of entries) {
      const occurred_at = new Date().toISOString();
      const [row] = await as(USER, () =>
        rows<{ id: string }>(
          `insert into transactions (kind, amount, account_id, to_account_id, subcategory_id, is_planned, occurred_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [entry.kind, entry.amount, entry.account_id, entry.to_account_id, entry.subcategory_id, entry.is_planned, occurred_at],
        ),
      );
      transactions.push({ ...entry, id: row.id, occurred_at, bucket_override_id: null });
    }
  });

  test("agrees with accountBalances() from the calculation library", async () => {
    const view = await as(USER, () =>
      rows<{ account_id: string; balance: number }>("select account_id, balance from account_balances"),
    );
    const expected = accountBalances(accounts, transactions);
    expect(new Map(view.map((r) => [r.account_id, Number(r.balance)]))).toEqual(expected);
    // Spot checks, so a shared mistake in both can't pass unnoticed.
    expect(expected.get(accounts[0].id)).toBe(1000000 - 12050 + 6000000 - 1234567 - 1000000 - 2500000 - 2500);
    expect(expected.get(accounts[1].id)).toBe(-250000 - 99900 + 5000 + 1234567);
    expect(expected.get(accounts[4].id)).toBe(70000);
  });

  test("shows each user only their own accounts", async () => {
    const seen = await as(OWNER, () => rows<{ user_id: string }>("select user_id from account_balances"));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.user_id === OWNER)).toBe(true);
    await expect(as(null, () => rows("select * from account_balances"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("search_transactions and transaction_totals", () => {
  const USER = "00000000-0000-4000-8000-000000000004";
  const accountsById = new Map<string, Account>();
  const transactions: Transaction[] = [];
  const ids: Record<string, string> = {};
  let rule: { buckets: BudgetBucket[]; assignments: Map<string, string> };
  const MARCH: Period = { start: "2026-03-01", end: "2026-04-01" };

  // The search as PostgREST calls it: named arguments, the rest left out.
  const search = (args: Record<string, unknown> = {}) =>
    as(USER, async () => {
      const names = Object.keys(args);
      const call = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      return (
        await rows<{ id: string }>(`select id from search_transactions(${call}) order by occurred_at, id`, Object.values(args))
      ).map((r) => r.id);
    });
  const totals = (args: Record<string, unknown> = {}) =>
    as(USER, async () => {
      const names = Object.keys(args);
      const call = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      const [row] = await rows<Record<string, string | number>>(`select * from transaction_totals(${call})`, Object.values(args));
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
    });

  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'fourth@example.com')", [USER]);
    for (const [name, type] of [
      ["Bank", "bank"],
      ["Card", "credit_card"],
      ["Fund", "savings"],
      ["Deposit", "savings"],
    ] as const) {
      const [row] = await as(USER, () =>
        rows<{ id: string }>("insert into accounts (name, type) values ($1, $2) returning id", [name, type]),
      );
      ids[name] = row.id;
      accountsById.set(row.id, { id: row.id, type, opening_balance: 0 });
    }
    for (const name of ["Rickshaw", "Groceries", "Gym & training", "Salary"]) {
      ids[name] = await subcategoryId(USER, name);
    }
    const buckets = await rows<BudgetBucket & { id: string }>(
      `select b.id, b.name, b.share_bp, b.holds_savings
         from budget_buckets b join budget_rules r on r.id = b.rule_id
        where r.user_id = $1 and r.is_active order by b.sort_order`,
      [USER],
    );
    for (const b of buckets) ids[b.name] = b.id;
    const assignments = await rows<{ subcategory_id: string; bucket_id: string }>(
      "select subcategory_id, bucket_id from bucket_assignments where user_id = $1",
      [USER],
    );
    rule = { buckets, assignments: new Map(assignments.map((a) => [a.subcategory_id, a.bucket_id])) };

    const { Bank, Card, Fund, Deposit, Rickshaw, Groceries, Salary } = ids;
    const gym = ids["Gym & training"];
    const entries: [string, Omit<Transaction, "id" | "occurred_at">][] = [
      // occurred_at in IST
      ["2026-02-28T23:59", { kind: "expense", amount: 11100, account_id: Bank, to_account_id: null, subcategory_id: Rickshaw, is_planned: false, bucket_override_id: null, note: "February" }],
      ["2026-03-01T00:30", { kind: "expense", amount: 12000, account_id: Bank, to_account_id: null, subcategory_id: Rickshaw, is_planned: false, bucket_override_id: null, note: "Auto to 50%_off sale" }],
      ["2026-03-02T09:00", { kind: "expense", amount: 45050, account_id: Card, to_account_id: null, subcategory_id: Groceries, is_planned: false, bucket_override_id: null, note: null }],
      ["2026-03-03T10:00", { kind: "refund", amount: 5000, account_id: Card, to_account_id: null, subcategory_id: Groceries, is_planned: false, bucket_override_id: null, note: "Returned" }],
      // Gym is a Want, but this one is overridden to Needs.
      ["2026-03-04T07:00", { kind: "expense", amount: 250000, account_id: Bank, to_account_id: null, subcategory_id: gym, is_planned: false, bucket_override_id: ids.Needs, note: null }],
      ["2026-03-04T08:00", { kind: "expense", amount: 70000, account_id: Bank, to_account_id: null, subcategory_id: gym, is_planned: false, bucket_override_id: null, note: null }],
      ["2026-03-05T10:00", { kind: "income", amount: 6000100, account_id: Bank, to_account_id: null, subcategory_id: Salary, is_planned: false, bucket_override_id: null, note: null }],
      ["2026-03-06T10:00", { kind: "transfer", amount: 1234567, account_id: Bank, to_account_id: Card, subcategory_id: null, is_planned: false, bucket_override_id: null, note: "Card bill" }],
      ["2026-03-07T10:00", { kind: "transfer", amount: 1000000, account_id: Bank, to_account_id: Fund, subcategory_id: null, is_planned: false, bucket_override_id: null, note: null }],
      ["2026-03-08T10:00", { kind: "transfer", amount: 200000, account_id: Fund, to_account_id: Bank, subcategory_id: null, is_planned: false, bucket_override_id: null, note: null }],
      // Between two savings accounts: neither saved nor withdrawn.
      ["2026-03-09T10:00", { kind: "transfer", amount: 300000, account_id: Fund, to_account_id: Deposit, subcategory_id: null, is_planned: false, bucket_override_id: null, note: null }],
      ["2026-03-10T10:00", { kind: "adjustment", amount: -2500, account_id: Bank, to_account_id: null, subcategory_id: null, is_planned: false, bucket_override_id: null, note: null }],
      // Planned: listed and counted, but not summed (BR-7).
      ["2026-03-31T23:00", { kind: "expense", amount: 1500000, account_id: Bank, to_account_id: null, subcategory_id: Rickshaw, is_planned: true, bucket_override_id: null, note: null }],
      ["2026-04-01T00:00", { kind: "expense", amount: 9900, account_id: Bank, to_account_id: null, subcategory_id: Rickshaw, is_planned: false, bucket_override_id: null, note: "April" }],
    ];
    for (const [when, entry] of entries) {
      const occurred_at = new Date(`${when}:00+05:30`).toISOString();
      const [row] = await as(USER, () =>
        rows<{ id: string }>(
          `insert into transactions (kind, amount, account_id, to_account_id, subcategory_id, is_planned, bucket_override_id, note, occurred_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [entry.kind, entry.amount, entry.account_id, entry.to_account_id, entry.subcategory_id, entry.is_planned, entry.bucket_override_id, entry.note, occurred_at],
        ),
      );
      transactions.push({ ...entry, id: row.id, occurred_at });
    }
  });

  const idsWhere = (keep: (t: Transaction) => boolean) => transactions.filter(keep).map((t) => t.id);
  const march = { since: istStartOf(MARCH.start).toISOString(), until: istStartOf(MARCH.end).toISOString() };

  test("with no filters, finds everything and totals agree with periodTotals()", async () => {
    expect(await search()).toEqual(transactions.map((t) => t.id));
    const all: Period = { start: "2000-01-01", end: "2100-01-01" };
    expect(await totals()).toEqual({
      entries: transactions.length,
      planned: 1,
      ...periodTotals(transactions, accountsById, all),
    });
  });

  test("a date range covers IST days, and its totals agree with periodTotals()", async () => {
    const found = await search(march);
    expect(found).toEqual(idsWhere((t) => periodContains(MARCH, t.occurred_at)));
    expect(found).toHaveLength(12);
    const expected = periodTotals(transactions, accountsById, MARCH);
    expect(await totals(march)).toEqual({ entries: 12, planned: 1, ...expected });
    // Spot checks, so a shared mistake in both can't pass unnoticed.
    expect(expected).toEqual({
      income: 6000100,
      spending: 12000 + 45050 - 5000 + 250000 + 70000,
      invested: 1000000,
      withdrawn: 200000,
    });
  });

  test("an account matches money out of it and into it", async () => {
    expect(await search({ account: ids.Card })).toEqual(
      idsWhere((t) => t.account_id === ids.Card || t.to_account_id === ids.Card),
    );
  });

  test("filters by category, subcategory and kind", async () => {
    const [{ id: food }] = await rows<{ id: string }>(
      "select id from categories where user_id = $1 and name = 'Food'",
      [USER],
    );
    expect(await search({ category: food })).toEqual(idsWhere((t) => t.subcategory_id === ids.Groceries));
    expect(await search({ subcategory: ids.Rickshaw })).toEqual(idsWhere((t) => t.subcategory_id === ids.Rickshaw));
    expect(await search({ kinds: ["expense", "refund"], ...march })).toEqual(
      idsWhere((t) => (t.kind === "expense" || t.kind === "refund") && periodContains(MARCH, t.occurred_at)),
    );
  });

  test("filters by the size of the amount", async () => {
    expect(await search({ min_amount: 2500, max_amount: 12000 })).toEqual(
      idsWhere((t) => Math.abs(t.amount) >= 2500 && Math.abs(t.amount) <= 12000),
    );
  });

  test("searches notes and subcategory names, taking % and _ literally", async () => {
    expect(await search({ search: "RICKSHAW" })).toEqual(idsWhere((t) => t.subcategory_id === ids.Rickshaw));
    expect(await search({ search: "50%_off" })).toEqual([transactions[1].id]);
    expect(await search({ search: "%" })).toEqual([transactions[1].id]);
    // As a wildcard, _ would match the space in "Auto to".
    expect(await search({ search: "auto_to" })).toEqual([]);
  });

  test("filters by tag", async () => {
    const [tag] = await as(USER, () =>
      rows<{ id: string }>("insert into tags (name) values ('Made-up Trip') returning id"),
    );
    for (const t of transactions.slice(1, 3)) {
      await as(USER, () => rows("insert into transaction_tags (transaction_id, tag_id) values ($1, $2)", [t.id, tag.id]));
    }
    expect(await search({ tag: tag.id })).toEqual([transactions[1].id, transactions[2].id]);
    expect((await totals({ tag: tag.id })).spending).toBe(12000 + 45050);
  });

  test("a bucket's totals agree with bucketActuals()", async () => {
    const actuals = bucketActuals(transactions, rule, accountsById, MARCH);
    for (const name of ["Needs", "Wants", "Savings"]) {
      const bucket = ids[name];
      const found = await totals({ bucket, ...march });
      const net = name === "Savings" ? found.invested - found.withdrawn : found.spending;
      expect(net).toBe(actuals.byBucket.get(bucket)!);
    }
    // The overridden gym session is in Needs, the other one in Wants.
    const needs = await search({ bucket: ids.Needs, ...march });
    expect(needs).toContain(transactions[4].id);
    expect(needs).not.toContain(transactions[5].id);
    expect(await search({ bucket: ids.Wants, subcategory: ids["Gym & training"] })).toEqual([transactions[5].id]);
    // Savings holds transfers into and out of savings, not between two of them.
    expect(await search({ bucket: ids.Savings })).toEqual([transactions[8].id, transactions[9].id]);
  });

  test("other users and signed-out visitors can't search this user's entries", async () => {
    const seen = await as(OWNER, () => rows<{ user_id: string }>("select user_id from search_transactions()"));
    expect(seen.every((r) => r.user_id === OWNER)).toBe(true);
    const [other] = await as(OWNER, () => rows<{ entries: number }>("select entries from transaction_totals(account => $1)", [ids.Bank]));
    expect(Number(other.entries)).toBe(0);
    await expect(as(null, () => rows("select * from search_transactions()"))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => rows("select * from transaction_totals()"))).rejects.toThrow(/permission denied/);
  });
});

describe("merging", () => {
  const USER = "00000000-0000-4000-8000-000000000005";
  let bank: string;

  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'fifth@example.com')", [USER]);
    bank = await makeAccount(USER, "Bank");
  });

  const spend = async (subcategory: string, amount = 10000) => {
    const [row] = await as(USER, () =>
      rows<{ id: string }>(
        `insert into transactions (kind, amount, account_id, subcategory_id, occurred_at)
         values ('expense', $1, $2, $3, now()) returning id`,
        [amount, bank, subcategory],
      ),
    );
    return row.id;
  };
  const subcategoryOf = async (transaction: string) =>
    (await rows<{ subcategory_id: string }>("select subcategory_id from transactions where id = $1", [transaction]))[0]
      .subcategory_id;
  const exists = async (table: string, id: string) =>
    (await rows(`select 1 from ${table} where id = $1`, [id])).length === 1;
  const merge = (fn: string, source: string, target: string) =>
    as(USER, () => rows(`select public.${fn}($1, $2)`, [source, target]));

  test("merging a subcategory moves its entries and commitments, then deletes it (FR-4 AC2)", async () => {
    const junk = await subcategoryId(USER, "Junk & treats");
    const eatingOut = await subcategoryId(USER, "Eating out");
    const entries = [await spend(junk), await spend(junk, 25000)];
    const kept = await spend(eatingOut);
    const [commitment] = await as(USER, () =>
      rows<{ id: string }>(
        `insert into recurring_commitments (name, kind, amount, account_id, subcategory_id, unit, first_due_on)
         values ('Weekly treat', 'expense', 20000, $1, $2, 'week', '2026-03-01') returning id`,
        [bank, junk],
      ),
    );

    await merge("merge_subcategory", junk, eatingOut);

    for (const id of [...entries, kept]) expect(await subcategoryOf(id)).toBe(eatingOut);
    const [moved] = await rows<{ subcategory_id: string }>(
      "select subcategory_id from recurring_commitments where id = $1",
      [commitment.id],
    );
    expect(moved.subcategory_id).toBe(eatingOut);
    expect(await exists("subcategories", junk)).toBe(false);
    const [{ n }] = await rows<{ n: number }>(
      "select count(*)::int as n from bucket_assignments where subcategory_id = $1",
      [junk],
    );
    expect(n).toBe(0);
  });

  test("won't merge across kinds, into itself, or Lost Track away", async () => {
    const groceries = await subcategoryId(USER, "Groceries");
    const salary = await subcategoryId(USER, "Salary");
    const lostTrack = await subcategoryId(USER, "Lost Track");
    await expect(merge("merge_subcategory", groceries, salary)).rejects.toThrow(/same kind/);
    await expect(merge("merge_subcategory", groceries, groceries)).rejects.toThrow(/into itself/);
    await expect(merge("merge_subcategory", lostTrack, groceries)).rejects.toThrow(/system subcategory/);
    // Lost Track can take others in.
    await merge("merge_subcategory", await subcategoryId(USER, "Healthy food"), lostTrack);
  });

  test("won't touch another user's subcategories", async () => {
    const mine = await subcategoryId(USER, "Rickshaw");
    const theirs = await subcategoryId(OWNER, "Bus");
    await expect(merge("merge_subcategory", theirs, mine)).rejects.toThrow(/not found/);
    await expect(merge("merge_subcategory", mine, theirs)).rejects.toThrow(/not found/);
    expect(await exists("subcategories", theirs)).toBe(true);
    await expect(as(null, () => rows("select public.merge_subcategory($1, $2)", [mine, theirs]))).rejects.toThrow(
      /permission denied/,
    );
  });

  test("merging a category moves its subcategories and merges ones with the same name", async () => {
    const category = async (name: string) =>
      (await rows<{ id: string }>("select id from categories where user_id = $1 and name = $2", [USER, name]))[0].id;
    const fun = await category("Fun & Travel");
    const personal = await category("Personal");
    // Personal and Fun & Travel both get a "Games & sports".
    const [{ id: personalGames }] = await as(USER, () =>
      rows<{ id: string }>(
        "insert into subcategories (category_id, kind, name) values ($1, 'expense', 'games & SPORTS') returning id",
        [personal],
      ),
    );
    const funGames = await subcategoryId(USER, "Games & sports");
    const trips = await subcategoryId(USER, "Trips");
    const game = await spend(funGames);

    await merge("merge_category", fun, personal);

    expect(await exists("categories", fun)).toBe(false);
    expect(await subcategoryOf(game)).toBe(personalGames);
    const moved = await rows<{ category_id: string }>("select category_id from subcategories where id = $1", [trips]);
    expect(moved[0].category_id).toBe(personal);
    const [{ n }] = await rows<{ n: number }>(
      "select count(*)::int as n from subcategories where category_id = $1 and lower(name) = 'games & sports'",
      [personal],
    );
    expect(n).toBe(1);
    const salaryCategory = await category("Salary");
    await expect(merge("merge_category", salaryCategory, personal)).rejects.toThrow(/same kind/);
  });
});

describe("skipping a due date", () => {
  const USER = "00000000-0000-4000-8000-000000000006";
  let gym: string;

  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'sixth@example.com')", [USER]);
    const bank = await makeAccount(USER, "Bank");
    const training = await subcategoryId(USER, "Gym & training");
    const [row] = await as(USER, () =>
      rows<{ id: string }>(
        `insert into recurring_commitments (name, kind, amount, account_id, subcategory_id, unit, first_due_on)
         values ('Gym', 'expense', 250000, $1, $2, 'month', '2026-07-10') returning id`,
        [bank, training],
      ),
    );
    gym = row.id;
  });

  const skip = (userId: string | null, date: string) =>
    as(userId, () => rows("insert into recurring_skips (recurring_id, due_on) values ($1, $2)", [gym, date]));
  const skips = () =>
    rows<{ due_on: string }>("select due_on::text from recurring_skips where recurring_id = $1 order by due_on", [
      gym,
    ]);

  test("records each skipped date once, and can be undone", async () => {
    await skip(USER, "2026-08-10");
    await expect(skip(USER, "2026-08-10")).rejects.toThrow(/duplicate key/);
    await skip(USER, "2026-09-10");
    await as(USER, () =>
      rows("delete from recurring_skips where recurring_id = $1 and due_on = '2026-09-10'", [gym]),
    );
    expect((await skips()).map((s) => s.due_on)).toEqual(["2026-08-10"]);
  });

  test("only the owner can see or skip their commitment's dates", async () => {
    expect(await as(OWNER, () => rows("select * from recurring_skips"))).toEqual([]);
    await expect(skip(OWNER, "2026-10-10")).rejects.toThrow(/foreign key/);
    await expect(skip(null, "2026-10-10")).rejects.toThrow(/permission denied/);
  });

  test("go when their commitment is deleted", async () => {
    await as(USER, () => rows("delete from recurring_commitments where id = $1", [gym]));
    expect(await skips()).toEqual([]);
  });
});

describe("Lost Track", () => {
  test("can be renamed but not deleted", async () => {
    const id = await subcategoryId(OWNER, "Lost Track");
    await as(OWNER, () => rows("update subcategories set name = 'Untracked' where id = $1", [id]));
    await expect(as(OWNER, () => rows("delete from subcategories where id = $1", [id]))).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  test("doesn't stop a whole user from being deleted", async () => {
    await db.query("delete from auth.users where id = $1", [OTHER]);
    const [{ n }] = await rows<{ n: number }>(
      "select count(*)::int as n from subcategories where user_id = $1",
      [OTHER],
    );
    expect(n).toBe(0);
  });
});
