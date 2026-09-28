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
