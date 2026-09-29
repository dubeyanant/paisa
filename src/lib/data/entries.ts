import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import type { RecentEntry } from "@/lib/entry";
import { searchArgs, type EntryFilters } from "@/lib/entry-filters";
import type { AccountType } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

export type AccountOption = { id: string; name: string; type: AccountType; archived: boolean };

export type SubcategoryOption = {
  id: string;
  name: string;
  kind: "expense" | "income";
  category_id: string;
  category: string;
  hidden: boolean;
};

export type Entry = RecentEntry & {
  id: string;
  description: string | null;
  is_planned: boolean;
  // Only when opened on its own, to edit or copy.
  tag_ids?: string[];
  bucket_override_id?: string | null;
};

export type TagOption = { id: string; name: string; starts_on: string | null; ends_on: string | null };

export type EntryContext = {
  // In the Accounts screen's order. Archived ones are only for showing old entries.
  accounts: AccountOption[];
  // In category order. Hidden ones are only for showing old entries.
  subcategories: SubcategoryOption[];
  // The latest entries up to now, newest first, for suggestions.
  recent: RecentEntry[];
  // Newest first.
  tags: TagOption[];
};

const ENTRY_COLUMNS =
  "id, kind, amount, account_id, to_account_id, subcategory_id, note, description, occurred_at, is_planned";

// How far back suggestions look: about the last few months for a daily logger.
const SUGGESTION_WINDOW = 1000;

export async function getEntryContext(): Promise<EntryContext> {
  await requireUser();
  const supabase = await createClient();
  const [labels, recent, tags] = await Promise.all([
    getLabels(),
    supabase
      .from("transactions")
      .select("kind, amount, account_id, to_account_id, subcategory_id, note, occurred_at")
      .neq("kind", "adjustment")
      .lte("occurred_at", new Date().toISOString())
      .order("occurred_at", { ascending: false })
      .limit(SUGGESTION_WINDOW),
    supabase.from("tags").select("id, name, starts_on, ends_on").order("created_at", { ascending: false }),
  ]);
  if (recent.error) throw recent.error;
  if (tags.error) throw tags.error;
  return {
    ...labels,
    recent: recent.data.map((t) => ({ ...(t as RecentEntry), amount: Number(t.amount) })),
    tags: tags.data,
  };
}

// Every account and subcategory, to name entries and offer choices.
export async function getLabels(): Promise<Omit<EntryContext, "recent" | "tags">> {
  await requireUser();
  const supabase = await createClient();
  const [accounts, categories, subcategories] = await Promise.all([
    supabase.from("accounts").select("id, name, type, archived_at").order("sort_order").order("name"),
    supabase.from("categories").select("id, name, sort_order, hidden_at"),
    supabase.from("subcategories").select("id, name, kind, category_id, sort_order, hidden_at"),
  ]);
  for (const result of [accounts, categories, subcategories]) if (result.error) throw result.error;

  const categoryById = new Map(
    categories.data!.map((c) => [c.id as string, c as { name: string; sort_order: number; hidden_at: string | null }]),
  );
  const subs = subcategories.data!.flatMap((s) => {
    const category = categoryById.get(s.category_id);
    if (!category) return [];
    return [
      {
        option: {
          id: s.id,
          name: s.name,
          kind: s.kind,
          category_id: s.category_id,
          category: category.name,
          hidden: Boolean(s.hidden_at || category.hidden_at),
        } as SubcategoryOption,
        order: [category.sort_order, category.name, s.sort_order, s.name] as const,
      },
    ];
  });
  subs.sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      if (a.order[i] < b.order[i]) return -1;
      if (a.order[i] > b.order[i]) return 1;
    }
    return 0;
  });

  return {
    accounts: accounts.data!.map((a) => ({ id: a.id, name: a.name, type: a.type, archived: Boolean(a.archived_at) })),
    subcategories: subs.map((s) => s.option),
  };
}

// The latest entries up to now, and the planned ones still to come.
export async function getLatestEntries(limit = 20) {
  await requireUser();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [past, planned] = await Promise.all([
    supabase.from("transactions").select(ENTRY_COLUMNS).lte("occurred_at", now).order("occurred_at", { ascending: false }).limit(limit),
    supabase.from("transactions").select(ENTRY_COLUMNS).gt("occurred_at", now).order("occurred_at").limit(5),
  ]);
  if (past.error) throw past.error;
  if (planned.error) throw planned.error;
  return { latest: past.data.map(toEntry), planned: planned.data.map(toEntry) };
}

export async function getEntry(id: string): Promise<Entry> {
  await requireUser();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(`${ENTRY_COLUMNS}, bucket_override_id, transaction_tags(tag_id)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const { transaction_tags, ...row } = data as Record<string, unknown> & { transaction_tags: { tag_id: string }[] };
  return { ...toEntry(row), tag_ids: transaction_tags.map((t) => t.tag_id) };
}

export type EntryTotals = {
  entries: number;
  // Counted in entries, but not in the sums (BR-7).
  planned: number;
  income: number;
  spending: number;
  invested: number;
  withdrawn: number;
};

// The entries matching the filters, newest first, so planned ones come on
// top (FR-8.3). The database applies the filters (TD-15).
export async function searchEntries(filters: EntryFilters, limit: number): Promise<Entry[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("search_transactions", searchArgs(filters))
    .select(ENTRY_COLUMNS)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(toEntry);
}

// Totals over every entry matching the filters, not just the ones shown.
export async function getEntryTotals(filters: EntryFilters): Promise<EntryTotals> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transaction_totals", searchArgs(filters)).single();
  if (error) throw error;
  const row = data as Record<keyof EntryTotals, number | string>;
  return {
    entries: Number(row.entries),
    planned: Number(row.planned),
    income: Number(row.income),
    spending: Number(row.spending),
    invested: Number(row.invested),
    withdrawn: Number(row.withdrawn),
  };
}

// Entries in a tag's dates that don't carry it yet, to suggest tagging them
// (FR-5). Balance corrections aren't suggested.
export async function getTagSuggestions(tagId: string, from: string, to: string): Promise<Entry[]> {
  await requireUser();
  const supabase = await createClient();
  const [entries, tagged] = await Promise.all([
    searchEntries({ from, to }, 300),
    supabase.from("transaction_tags").select("transaction_id").eq("tag_id", tagId).limit(1000),
  ]);
  if (tagged.error) throw tagged.error;
  const done = new Set(tagged.data.map((t) => t.transaction_id));
  return entries.filter((e) => e.kind !== "adjustment" && !done.has(e.id));
}

export type FilterOptions = {
  // The active budget rule's buckets (FR-7).
  buckets: { id: string; name: string }[];
  tags: { id: string; name: string }[];
};

export async function getFilterOptions(): Promise<FilterOptions> {
  await requireUser();
  const supabase = await createClient();
  const [rules, tags] = await Promise.all([
    supabase.from("budget_rules").select("id, budget_buckets(id, name, sort_order)").eq("is_active", true),
    supabase.from("tags").select("id, name").order("name"),
  ]);
  if (rules.error) throw rules.error;
  if (tags.error) throw tags.error;
  const buckets = (rules.data[0]?.budget_buckets ?? []) as { id: string; name: string; sort_order: number }[];
  return {
    buckets: buckets.sort((a, b) => a.sort_order - b.sort_order).map(({ id, name }) => ({ id, name })),
    tags: tags.data,
  };
}

function toEntry(row: Record<string, unknown>): Entry {
  return { ...(row as Entry), amount: Number(row.amount) };
}
