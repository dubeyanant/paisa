// One-time import of the old app's history (TD-12).
//
//   bun scripts/import-history/import.ts <export.xlsx>          dry run: checks and writes a review
//   bun scripts/import-history/import.ts <export.xlsx> --write  imports as one batch
//
// Reads the mapping from .private/import-mapping.ts and signs in as the owner
// with PAISA_EMAIL and PAISA_PASSWORD from .env.local, so RLS applies as for
// any other write. The review goes to .private/import-review.md. Both files
// hold personal data and are git-ignored (TD-6).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { applyMapping, type Mapping, type MappingResult, type PlannedTransaction } from "./mapping";
import { cleanName, readExport, type ExportRow } from "./read-export";

const PRIVATE_DIR = join(import.meta.dir, "..", "..", ".private");
const CHUNK = 500;

type Account = { id: string; name: string; type: string };
type Subcategory = { id: string; name: string; kind: string; categories: { name: string } };

const key = (s: string) => s.trim().toLowerCase();
const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const istDate = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const md = (s: string) => s.replace(/\|/g, "\\|");

async function signIn(): Promise<SupabaseClient> {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable } = process.env;
  const { PAISA_EMAIL: email, PAISA_PASSWORD: password } = process.env;
  if (!url || !publishable) throw new Error("Supabase URL or key missing from .env");
  if (!email || !password) throw new Error("PAISA_EMAIL and PAISA_PASSWORD must be set in .env.local");
  const supabase = createClient(url, publishable, { auth: { persistSession: false } });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.code ?? error.message}`);
  return supabase;
}

// PostgREST returns at most 1000 rows per request.
// Without generated database types the client mistypes joined rows, so callers name the row type.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return all;
  }
}

function subcategoryKey(kind: string, path: string) {
  const [category, sub] = path.split(">").map((s) => s.trim());
  return `${kind}|${key(category)}|${key(sub ?? "")}`;
}

function neededKind(p: PlannedTransaction) {
  return p.kind === "income" ? "income" : "expense";
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const write = flags.includes("--write");
  if (!file) throw new Error("Usage: bun scripts/import-history/import.ts <export.xlsx> [--write]");

  const mapping: Mapping = (await import(join(PRIVATE_DIR, "import-mapping.ts"))).default;
  const { rows, unreadable } = readExport(readFileSync(file));
  const result = applyMapping(rows, mapping, new Date());

  const supabase = await signIn();
  const accounts = await fetchAll<Account>((a, b) => supabase.from("accounts").select("id, name, type").range(a, b));
  const subcategories = await fetchAll<Subcategory>((a, b) =>
    supabase.from("subcategories").select("id, name, kind, categories(name)").range(a, b),
  );
  const existingKeys = new Set(
    (
      await fetchAll<{ import_key: string }>((a, b) =>
        supabase.from("transactions").select("import_key").not("import_key", "is", null).range(a, b),
      )
    ).map((t) => t.import_key),
  );

  // Which subcategories the mapping points at that don't exist and aren't created by it.
  const knownSubs = new Set([
    ...subcategories.map((s) => `${s.kind}|${key(s.categories.name)}|${key(s.name)}`),
    ...(mapping.newSubcategories ?? []).map((n) => subcategoryKey("expense", `${n.category} > ${n.name}`)),
  ]);
  const missingTargets = [
    ...new Set(
      result.planned
        .filter((p) => p.subcategory && !knownSubs.has(subcategoryKey(neededKind(p), p.subcategory)))
        .map((p) => `${neededKind(p)}: ${p.subcategory}`),
    ),
  ];
  const alreadyImported = result.planned.filter((p) => existingKeys.has(p.importKey));
  const toImport = result.planned.filter((p) => !existingKeys.has(p.importKey));

  const reviewPath = writeReview({ file, rows, unreadable, result, mapping, accounts, missingTargets, alreadyImported });

  console.log(`Rows read: ${rows.length} (unreadable: ${unreadable.length})`);
  console.log(`To import: ${toImport.length} | already imported: ${alreadyImported.length} | skipped: ${result.skipped.length}`);
  console.log(`Unmapped rows: ${result.unmapped.length} | unknown accounts: ${result.unknownAccounts.length} | missing subcategories: ${missingTargets.length}`);
  console.log(`Review: ${reviewPath}`);

  const blocked = result.unmapped.length + result.unknownAccounts.length + missingTargets.length + unreadable.length;
  if (!write) return console.log("\nDry run: nothing was written. Add --write to import.");
  if (blocked > 0) throw new Error("Not importing: fix the problems listed in the review first.");
  if (toImport.length === 0) return console.log("\nNothing new to import.");

  await importRows(supabase, file, mapping, toImport, rows, accounts);
}

async function importRows(
  supabase: SupabaseClient,
  file: string,
  mapping: Mapping,
  toImport: PlannedTransaction[],
  rows: ExportRow[],
  existing: Account[],
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  // 1. Accounts the mapping names that don't exist yet. They open at zero on
  //    their first day in the export; the balance step corrects them later.
  const accountIds = new Map(existing.map((a) => [key(a.name), a.id]));
  const firstSeen = new Map<string, Date>();
  for (const p of toImport) {
    for (const name of [p.account, p.toAccount]) {
      if (name && (!firstSeen.has(key(name)) || p.occurredAt < firstSeen.get(key(name))!)) firstSeen.set(key(name), p.occurredAt);
    }
  }
  for (const [oldName, m] of Object.entries(mapping.accounts)) {
    const name = m.name ?? oldName;
    if (accountIds.has(key(name)) || !firstSeen.has(key(name))) continue;
    const { data, error } = await supabase
      .from("accounts")
      .insert({ name, type: m.type, is_emergency_fund: m.isEmergencyFund ?? false, opening_balance: 0, opening_date: istDate(firstSeen.get(key(name))!) })
      .select("id")
      .single();
    if (error) throw error;
    accountIds.set(key(name), data.id);
    console.log(`Created account: ${name} (${m.type})`);
  }

  // 2. New subcategories, each with a bucket in the active rule.
  const { data: rule } = await supabase.from("budget_rules").select("id, budget_buckets(id, name)").eq("is_active", true).single();
  for (const n of mapping.newSubcategories ?? []) {
    const { data: category } = await supabase.from("categories").select("id, kind").eq("kind", "expense").ilike("name", n.category).single();
    if (!category) throw new Error(`No expense category named ${n.category}`);
    const { data: found } = await supabase.from("subcategories").select("id").eq("category_id", category.id).ilike("name", n.name).maybeSingle();
    if (found) continue;
    const { data: sub, error } = await supabase
      .from("subcategories")
      .insert({ category_id: category.id, kind: "expense", name: n.name, sort_order: 100 })
      .select("id")
      .single();
    if (error) throw error;
    const bucket = rule?.budget_buckets.find((b: { name: string }) => key(b.name) === key(n.bucket ?? "Wants"));
    if (rule && bucket) {
      await supabase.from("bucket_assignments").insert({ rule_id: rule.id, subcategory_id: sub.id, bucket_id: bucket.id });
    }
    console.log(`Created subcategory: ${n.category} > ${n.name}`);
  }
  const subcategories = await fetchAll<Subcategory>((a, b) =>
    supabase.from("subcategories").select("id, name, kind, categories(name)").range(a, b),
  );
  const subIds = new Map(subcategories.map((s) => [`${s.kind}|${key(s.categories.name)}|${key(s.name)}`, s.id]));

  // 3. Tags. Names are unique ignoring case, so look them up before adding.
  const tagNames = [...new Set(toImport.flatMap((p) => p.tags))];
  const tags = await fetchAll<{ id: string; name: string }>((a, b) => supabase.from("tags").select("id, name").range(a, b));
  const tagIds = new Map(tags.map((t) => [key(t.name), t.id]));
  for (const name of tagNames) {
    if (tagIds.has(key(name))) continue;
    const { data, error } = await supabase.from("tags").insert({ name }).select("id").single();
    if (error) throw error;
    tagIds.set(key(name), data.id);
  }

  // 4. The batch, then its transactions.
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({ file_name: basename(file) })
    .select("id")
    .single();
  if (batchError) throw batchError;

  let inserted = 0;
  for (let i = 0; i < toImport.length; i += CHUNK) {
    const chunk = toImport.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("transactions")
      .upsert(
        chunk.map((p) => ({
          user_id: userId,
          kind: p.kind,
          occurred_at: p.occurredAt.toISOString(),
          amount: p.amount,
          account_id: accountIds.get(key(p.account)),
          to_account_id: p.toAccount ? accountIds.get(key(p.toAccount)) : null,
          subcategory_id: p.subcategory ? subIds.get(subcategoryKey(neededKind(p), p.subcategory)) : null,
          note: p.note,
          description: p.description,
          is_planned: p.isPlanned,
          import_batch_id: batch.id,
          import_key: p.importKey,
          import_source: p.importSource,
        })),
        { onConflict: "user_id,import_key", ignoreDuplicates: true },
      )
      .select("id, import_key");
    if (error) throw error;

    const byKey = new Map(chunk.map((p) => [p.importKey, p]));
    const links = (data ?? []).flatMap((t) =>
      byKey.get(t.import_key)!.tags.map((name) => ({ transaction_id: t.id, tag_id: tagIds.get(key(name))! })),
    );
    if (links.length > 0) {
      const { error: tagError } = await supabase.from("transaction_tags").insert(links);
      if (tagError) throw tagError;
    }
    inserted += data?.length ?? 0;
    console.log(`Imported ${inserted} / ${toImport.length}`);
  }

  await supabase.from("import_batches").update({ row_count: inserted }).eq("id", batch.id);
  console.log(`\nDone. Batch ${batch.id}: ${inserted} transactions from ${rows.length} rows.`);
  console.log("Undo: delete that row from import_batches; its transactions go with it.");
}

function writeReview(input: {
  file: string;
  rows: ExportRow[];
  unreadable: { line: number; reason: string }[];
  result: MappingResult;
  mapping: Mapping;
  accounts: Account[];
  missingTargets: string[];
  alreadyImported: PlannedTransaction[];
}) {
  const { file, rows, unreadable, result, mapping, accounts, missingTargets, alreadyImported } = input;
  const out: string[] = [`# Import review: ${basename(file)}`, "", `Generated ${new Date().toISOString()}. Private: never commit this file.`, ""];

  const dates = rows.map((r) => r.occurredAt.getTime());
  out.push(`- Rows: ${rows.length}, from ${istDate(new Date(Math.min(...dates)))} to ${istDate(new Date(Math.max(...dates)))}`);
  out.push(`- To import: ${result.planned.length - alreadyImported.length}; already imported: ${alreadyImported.length}; skipped: ${result.skipped.length}`);
  out.push(`- Planned (future-dated): ${result.planned.filter((p) => p.isPlanned).length}`, "");

  out.push("## Problems (must be empty before --write)", "");
  const problems = [
    ...unreadable.map((u) => `- Unreadable row ${u.line}: ${u.reason}`),
    ...result.unknownAccounts.map((a) => `- Account not in the mapping: ${md(a)}`),
    ...missingTargets.map((t) => `- Target subcategory doesn't exist: ${md(t)}`),
    ...[...new Set(result.unmapped.map((r) => `${r.type} | ${cleanName(r.category)} > ${cleanName(r.subcategory) || "(none)"}`))].map(
      (p) => `- No rule for: ${md(p)}`,
    ),
  ];
  out.push(...(problems.length ? problems : ["None."]), "");

  out.push("## Reconciliation: file vs import, per year and type (FR-14.2 step 4)", "");
  out.push("| Year | Type | File | Imported | Skipped | Matches |", "|---|---|---|---|---|---|");
  const totals = new Map<string, { file: number; imported: number; skipped: number }>();
  const add = (row: { occurredAt: Date; type: string }, field: "file" | "imported" | "skipped", amount: number) => {
    const k = `${istDate(row.occurredAt).slice(0, 4)}|${row.type}`;
    const t = totals.get(k) ?? { file: 0, imported: 0, skipped: 0 };
    t[field] += amount;
    totals.set(k, t);
  };
  for (const r of rows) add(r, "file", r.amount);
  for (const p of result.planned) add({ occurredAt: p.occurredAt, type: p.importSource.type }, "imported", Math.abs(p.amount));
  for (const s of result.skipped) add(s.row, "skipped", s.row.amount);
  for (const r of result.unmapped) add(r, "skipped", r.amount);
  for (const [k, t] of [...totals].sort()) {
    const [year, type] = k.split("|");
    out.push(`| ${year} | ${type} | ${rupees(t.file)} | ${rupees(t.imported)} | ${rupees(t.skipped)} | ${t.file === t.imported + t.skipped ? "yes" : "**NO**"} |`);
  }
  out.push("", "Skipped includes unmapped rows. Imported uses the file's type, even where a rule changes the kind.", "");

  out.push("## Accounts", "", "| Old name | In Paisa | Type | Rows | First | Last | Status |", "|---|---|---|---|---|---|---|");
  const usage = new Map<string, { n: number; first: Date; last: Date }>();
  for (const r of rows) {
    for (const name of r.type.startsWith("Transfer") ? [r.account, r.category] : [r.account]) {
      const u = usage.get(name) ?? { n: 0, first: r.occurredAt, last: r.occurredAt };
      u.n++;
      if (r.occurredAt < u.first) u.first = r.occurredAt;
      if (r.occurredAt > u.last) u.last = r.occurredAt;
      usage.set(name, u);
    }
  }
  for (const [old, u] of [...usage].sort((a, b) => b[1].n - a[1].n)) {
    const m = Object.entries(mapping.accounts).find(([n]) => key(n) === key(old));
    const name = m ? (m[1].name ?? m[0]) : "—";
    const status = !m ? "**not mapped**" : accounts.some((a) => key(a.name) === key(name)) ? "exists" : "will be created";
    out.push(`| ${md(old)} | ${md(name)} | ${m?.[1].type ?? ""}${m?.[1].isEmergencyFund ? " (emergency fund)" : ""} | ${u.n} | ${istDate(u.first)} | ${istDate(u.last)} | ${status} |`);
  }
  out.push("");

  out.push("## Categories", "", "| Old (type, category > subcategory) | Becomes | Rows | First | Last | Example notes |", "|---|---|---|---|---|---|");
  const pairs = new Map<string, { targets: Map<string, number>; n: number; first: Date; last: Date; notes: Map<string, number> }>();
  const note = (r: ExportRow, target: string) => {
    if (r.type.startsWith("Transfer")) return;
    const k = `${r.type} | ${cleanName(r.category)} > ${cleanName(r.subcategory) || "(none)"}`;
    const p = pairs.get(k) ?? { targets: new Map(), n: 0, first: r.occurredAt, last: r.occurredAt, notes: new Map() };
    p.n++;
    p.targets.set(target, (p.targets.get(target) ?? 0) + 1);
    if (r.occurredAt < p.first) p.first = r.occurredAt;
    if (r.occurredAt > p.last) p.last = r.occurredAt;
    if (r.note) p.notes.set(r.note, (p.notes.get(r.note) ?? 0) + 1);
    pairs.set(k, p);
  };
  const byLine = new Map(rows.map((r) => [r.line, r]));
  for (const p of result.planned) {
    const target =
      p.kind === "transfer" ? `transfer to ${p.toAccount}` : p.kind === "adjustment" ? "balance adjustment" : `${p.kind === "refund" ? "refund: " : ""}${p.subcategory}`;
    note(byLine.get(p.line)!, target);
  }
  for (const s of result.skipped) note(s.row, `skipped: ${s.reason}`);
  for (const r of result.unmapped) note(r, "**NO RULE**");
  for (const [k, p] of [...pairs].sort()) {
    const targets = [...p.targets].map(([t, n]) => (p.targets.size > 1 ? `${t} (${n})` : t)).join("; ");
    const examples = [...p.notes].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join("; ");
    out.push(`| ${md(k)} | ${md(targets)} | ${p.n} | ${istDate(p.first)} | ${istDate(p.last)} | ${md(examples)} |`);
  }
  out.push("");

  const tagCounts = new Map<string, number>();
  for (const p of result.planned) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  out.push("## Tags from notes", "", ...[...tagCounts].map(([t, n]) => `- ${md(t)}: ${n} row${n === 1 ? "" : "s"}`), "");

  out.push("## Planned (future-dated) rows", "");
  for (const p of result.planned.filter((p) => p.isPlanned)) {
    out.push(`- ${istDate(p.occurredAt)}: ${p.kind} ${rupees(Math.abs(p.amount))} ${md(p.account)}${p.toAccount ? ` → ${md(p.toAccount)}` : ""} ${md(p.note ?? "")}`);
  }
  out.push("");

  out.push("## Skipped rows", "");
  for (const s of result.skipped) out.push(`- Row ${s.row.line} (${istDate(s.row.occurredAt)}, ${rupees(s.row.amount)}, ${md(s.row.note)}): ${md(s.reason)}`);
  if (result.skipped.length === 0) out.push("None.");

  mkdirSync(PRIVATE_DIR, { recursive: true });
  const path = join(PRIVATE_DIR, "import-review.md");
  writeFileSync(path, out.join("\n") + "\n");
  return path;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
