"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseName, reorder } from "@/lib/categories";
import { isUuid } from "@/lib/data/accounts";
import { createClient } from "@/lib/supabase/server";

// Changes to categories and subcategories (FR-4). Each one refreshes every
// screen, since names, buckets and merges show up in every report.

export type CategoryResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): CategoryResult => ({ ok: false, error });
const MISSING = "That category doesn't exist any more. Reload and try again.";
const TRY_AGAIN = "Couldn't save the change. Please try again.";

function done(): CategoryResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function failed(what: string, error: { code?: string; message: string }): CategoryResult {
  console.error(`${what} failed:`, error.code, error.message);
  return fail(TRY_AGAIN);
}

export async function addCategory(kind: "expense" | "income", name: string): Promise<CategoryResult> {
  await requireUser();
  if (kind !== "expense" && kind !== "income") return fail(TRY_AGAIN);
  const parsed = parseName(name, "category");
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1);
  const { error } = await supabase
    .from("categories")
    .insert({ kind, name: parsed.name, sort_order: (last?.[0]?.sort_order ?? 0) + 1 });
  if (error?.code === "23505") return fail(`There's already a category called "${parsed.name}".`);
  if (error) return failed("Adding a category", error);
  return done();
}

// A new subcategory. An expense one goes in `bucketId`, one of the active
// rule's buckets (FR-4: every subcategory has a bucket).
export async function addSubcategory(
  categoryId: string,
  name: string,
  bucketId: string | null,
): Promise<CategoryResult> {
  await requireUser();
  if (!isUuid(categoryId) || (bucketId !== null && !isUuid(bucketId))) return fail(MISSING);
  const parsed = parseName(name, "subcategory");
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data: category, error: readError } = await supabase
    .from("categories")
    .select("kind, subcategories(sort_order)")
    .eq("id", categoryId)
    .maybeSingle();
  if (readError) return failed("Reading a category", readError);
  if (!category) return fail(MISSING);
  if (category.kind === "expense" && !bucketId) return fail("Choose a budget bucket for it.");

  const orders = (category.subcategories as { sort_order: number }[]).map((s) => s.sort_order);
  const { data: sub, error } = await supabase
    .from("subcategories")
    .insert({
      category_id: categoryId,
      kind: category.kind,
      name: parsed.name,
      sort_order: Math.max(0, ...orders) + 1,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return fail(`This category already has "${parsed.name}".`);
  if (error) return failed("Adding a subcategory", error);

  if (category.kind === "expense" && bucketId) {
    const result = await assignBucket(sub.id, bucketId);
    if (!result.ok) return result;
  }
  return done();
}

export async function renameCategory(id: string, name: string): Promise<CategoryResult> {
  return rename("categories", id, name, "category");
}

export async function renameSubcategory(id: string, name: string): Promise<CategoryResult> {
  return rename("subcategories", id, name, "subcategory");
}

async function rename(
  table: "categories" | "subcategories",
  id: string,
  name: string,
  what: string,
): Promise<CategoryResult> {
  await requireUser();
  if (!isUuid(id)) return fail(MISSING);
  const parsed = parseName(name, what);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).update({ name: parsed.name }).eq("id", id).select("id");
  if (error?.code === "23505") return fail(`There's already a ${what} called "${parsed.name}" there.`);
  if (error) return failed(`Renaming a ${what}`, error);
  if (data.length === 0) return fail(MISSING);
  return done();
}

// Hidden ones leave the Add screen but stay in every report (FR-4).
export async function setHidden(
  table: "categories" | "subcategories",
  id: string,
  hidden: boolean,
): Promise<CategoryResult> {
  await requireUser();
  if ((table !== "categories" && table !== "subcategories") || !isUuid(id)) return fail(MISSING);
  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return failed("Hiding", error);
  return done();
}

// Moves one place up or down among its siblings, and numbers them all afresh.
export async function move(
  table: "categories" | "subcategories",
  id: string,
  direction: "up" | "down",
): Promise<CategoryResult> {
  await requireUser();
  if ((table !== "categories" && table !== "subcategories") || !isUuid(id)) return fail(MISSING);
  if (direction !== "up" && direction !== "down") return fail(TRY_AGAIN);
  const supabase = await createClient();

  // Siblings: categories of the same kind, or subcategories of the same category.
  const { data: self, error: selfError } = await supabase
    .from(table)
    .select(table === "categories" ? "kind" : "category_id")
    .eq("id", id)
    .maybeSingle();
  if (selfError) return failed("Reordering", selfError);
  if (!self) return fail(MISSING);
  const [column, value] = Object.entries(self)[0] as [string, string];
  const { data: siblings, error } = await supabase
    .from(table)
    .select("id, sort_order")
    .eq(column, value)
    .order("sort_order")
    .order("name");
  if (error) return failed("Reordering", error);

  const order = reorder(siblings.map((s) => s.id), id, direction);
  if (!order) return { ok: true };
  const updates = order
    .map((siblingId, index) => ({ id: siblingId, sort_order: index + 1 }))
    .filter((u) => siblings.find((s) => s.id === u.id)!.sort_order !== u.sort_order);
  for (const u of updates) {
    const { error: updateError } = await supabase.from(table).update({ sort_order: u.sort_order }).eq("id", u.id);
    if (updateError) return failed("Reordering", updateError);
  }
  return done();
}

// Puts a subcategory under another category of the same kind.
export async function moveToCategory(id: string, categoryId: string): Promise<CategoryResult> {
  await requireUser();
  if (!isUuid(id) || !isUuid(categoryId)) return fail(MISSING);
  const supabase = await createClient();
  const { data: siblings } = await supabase.from("subcategories").select("sort_order").eq("category_id", categoryId);
  const { data, error } = await supabase
    .from("subcategories")
    .update({ category_id: categoryId, sort_order: Math.max(0, ...(siblings ?? []).map((s) => s.sort_order)) + 1 })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") return fail("That category already has a subcategory with this name. Merge them instead.");
  // The foreign key includes the kind, so spending can't move under income.
  if (error?.code === "23503") return fail("A subcategory can only move to a category of the same kind.");
  if (error) return failed("Moving a subcategory", error);
  if (data.length === 0) return fail(MISSING);
  return done();
}

// Changes which bucket of the active rule a subcategory counts in, for every
// month (FR-4 AC3).
export async function setBucket(subcategoryId: string, bucketId: string): Promise<CategoryResult> {
  await requireUser();
  if (!isUuid(subcategoryId) || !isUuid(bucketId)) return fail(MISSING);
  const result = await assignBucket(subcategoryId, bucketId);
  return result.ok ? done() : result;
}

async function assignBucket(subcategoryId: string, bucketId: string): Promise<CategoryResult> {
  const supabase = await createClient();
  const { data: bucket, error: readError } = await supabase
    .from("budget_buckets")
    .select("rule_id")
    .eq("id", bucketId)
    .maybeSingle();
  if (readError) return failed("Reading a bucket", readError);
  if (!bucket) return fail("That bucket doesn't exist any more. Reload and try again.");
  const { error } = await supabase
    .from("bucket_assignments")
    .upsert(
      { rule_id: bucket.rule_id, subcategory_id: subcategoryId, bucket_id: bucketId },
      { onConflict: "rule_id,subcategory_id" },
    );
  if (error?.code === "23503") return fail(MISSING);
  if (error) return failed("Changing a bucket", error);
  return { ok: true };
}

// Moves every entry of one into the other, then deletes the first (FR-4 AC2).
// All or nothing, in the database.
export async function merge(
  what: "category" | "subcategory",
  sourceId: string,
  targetId: string,
): Promise<CategoryResult> {
  await requireUser();
  if ((what !== "category" && what !== "subcategory") || !isUuid(sourceId) || !isUuid(targetId)) {
    return fail(MISSING);
  }
  if (sourceId === targetId) return fail(`Choose another ${what} to merge into.`);
  const supabase = await createClient();
  const { error } = await supabase.rpc(what === "category" ? "merge_category" : "merge_subcategory", {
    source: sourceId,
    target: targetId,
  });
  if (error?.code === "P0002") return fail(MISSING);
  if (error?.message.includes("system subcategory")) return fail("Lost Track can't be merged away. Rename it instead.");
  if (error?.message.includes("same kind")) return fail("Spending and income can't be merged together.");
  if (error) return failed(`Merging a ${what}`, error);
  return done();
}

// Only while nothing uses it: the database refuses otherwise, and the owner
// can merge or hide it instead (TD-13).
export async function remove(what: "category" | "subcategory", id: string): Promise<CategoryResult> {
  await requireUser();
  if ((what !== "category" && what !== "subcategory") || !isUuid(id)) return fail(MISSING);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(what === "category" ? "categories" : "subcategories")
    .delete()
    .eq("id", id)
    .select("id");
  if (error?.code === "23503") {
    return fail(
      what === "category"
        ? "This category still has subcategories. Merge it into another, or delete them first."
        : "Entries or recurring bills use this subcategory. Merge it into another, or hide it.",
    );
  }
  if (error?.message.includes("cannot be deleted")) return fail("Lost Track can't be deleted. Rename it instead.");
  if (error) return failed(`Deleting a ${what}`, error);
  if (data.length === 0) return fail(MISSING);
  return done();
}
