import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import type { RecentEntry } from "@/lib/entry";
import type { AccountType } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

export type AccountOption = { id: string; name: string; type: AccountType; archived: boolean };

export type SubcategoryOption = {
  id: string;
  name: string;
  kind: "expense" | "income";
  category: string;
  hidden: boolean;
};

export type Entry = RecentEntry & { id: string; description: string | null; is_planned: boolean };

export type EntryContext = {
  // In the Accounts screen's order. Archived ones are only for showing old entries.
  accounts: AccountOption[];
  // In category order. Hidden ones are only for showing old entries.
  subcategories: SubcategoryOption[];
  // The latest entries up to now, newest first, for suggestions.
  recent: RecentEntry[];
};

const ENTRY_COLUMNS =
  "id, kind, amount, account_id, to_account_id, subcategory_id, note, description, occurred_at, is_planned";

// How far back suggestions look: about the last few months for a daily logger.
const SUGGESTION_WINDOW = 1000;

export async function getEntryContext(): Promise<EntryContext> {
  await requireUser();
  const supabase = await createClient();
  const [labels, recent] = await Promise.all([
    getLabels(),
    supabase
      .from("transactions")
      .select("kind, amount, account_id, to_account_id, subcategory_id, note, occurred_at")
      .neq("kind", "adjustment")
      .lte("occurred_at", new Date().toISOString())
      .order("occurred_at", { ascending: false })
      .limit(SUGGESTION_WINDOW),
  ]);
  if (recent.error) throw recent.error;
  return { ...labels, recent: recent.data.map((t) => ({ ...(t as RecentEntry), amount: Number(t.amount) })) };
}

// Every account and subcategory, to name entries and offer choices.
export async function getLabels(): Promise<Omit<EntryContext, "recent">> {
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
  const { data, error } = await supabase.from("transactions").select(ENTRY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return toEntry(data);
}

function toEntry(row: Record<string, unknown>): Entry {
  return { ...(row as Entry), amount: Number(row.amount) };
}
