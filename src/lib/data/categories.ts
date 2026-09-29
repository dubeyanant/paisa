import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import { createClient } from "@/lib/supabase/server";

export type SubcategoryRow = {
  id: string;
  name: string;
  is_system: boolean;
  hidden: boolean;
  // Its bucket in the active budget rule. Expense subcategories only.
  bucket_id: string | null;
};

export type CategoryRow = {
  id: string;
  name: string;
  kind: "expense" | "income";
  hidden: boolean;
  subcategories: SubcategoryRow[];
};

export type CategoryTree = {
  categories: CategoryRow[];
  // The active rule's buckets (FR-7).
  buckets: { id: string; name: string }[];
};

// Every category and subcategory, hidden ones included, in the owner's order.
export async function getCategoryTree(): Promise<CategoryTree> {
  await requireUser();
  const supabase = await createClient();
  const [categories, subcategories, rules] = await Promise.all([
    supabase.from("categories").select("id, name, kind, hidden_at").order("sort_order").order("name"),
    supabase
      .from("subcategories")
      .select("id, name, category_id, is_system, hidden_at")
      .order("sort_order")
      .order("name"),
    supabase
      .from("budget_rules")
      .select("id, budget_buckets(id, name, sort_order, bucket_assignments(subcategory_id))")
      .eq("is_active", true),
  ]);
  for (const result of [categories, subcategories, rules]) if (result.error) throw result.error;

  const buckets = ((rules.data![0]?.budget_buckets ?? []) as {
    id: string;
    name: string;
    sort_order: number;
    bucket_assignments: { subcategory_id: string }[];
  }[]).sort((a, b) => a.sort_order - b.sort_order);
  const bucketOf = new Map(buckets.flatMap((b) => b.bucket_assignments.map((a) => [a.subcategory_id, b.id] as const)));
  const byCategory = new Map<string, SubcategoryRow[]>();
  for (const s of subcategories.data!) {
    const list = byCategory.get(s.category_id) ?? [];
    list.push({
      id: s.id,
      name: s.name,
      is_system: s.is_system,
      hidden: Boolean(s.hidden_at),
      bucket_id: bucketOf.get(s.id) ?? null,
    });
    byCategory.set(s.category_id, list);
  }

  return {
    categories: categories.data!.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      hidden: Boolean(c.hidden_at),
      subcategories: byCategory.get(c.id) ?? [],
    })),
    buckets: buckets.map(({ id, name }) => ({ id, name })),
  };
}

export type TagRow = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  entries: number;
};

// Every tag, newest first, with how many entries carry it.
export async function listTags(): Promise<TagRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, starts_on, ends_on, transaction_tags(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    name: t.name,
    starts_on: t.starts_on,
    ends_on: t.ends_on,
    entries: (t.transaction_tags as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

export async function getTag(id: string): Promise<TagRow> {
  await requireUser();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, starts_on, ends_on, transaction_tags(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return {
    id: data.id,
    name: data.name,
    starts_on: data.starts_on,
    ends_on: data.ends_on,
    entries: (data.transaction_tags as unknown as { count: number }[])[0]?.count ?? 0,
  };
}
