import "server-only";
import { requireUser } from "@/lib/auth";
import { listTags, type TagRow } from "@/lib/data/categories";
import { getLabels } from "@/lib/data/entries";
import { allRows, TRANSACTION_COLUMNS } from "@/lib/data/paging";
import { tagReports, type TagReport } from "@/lib/finance/tags";
import { createClient } from "@/lib/supabase/server";

// A report for every tag in use (INS-13), and every tag. Only tagged
// transactions are loaded, so this stays small however long the history is.
export async function getTagReports(): Promise<{
  tags: TagRow[];
  reports: Map<string, TagReport>;
  // Subcategory → category.
  categoryOf: Map<string, string>;
  categoryName: Map<string, string>;
  subcategoryName: Map<string, string>;
}> {
  await requireUser();
  const supabase = await createClient();
  const tagsByTransaction = new Map<string, string[]>();
  const [tags, labels, transactions] = await Promise.all([
    listTags(),
    getLabels(),
    allRows((from, to) =>
      supabase
        .from("transactions")
        .select(`${TRANSACTION_COLUMNS}, transaction_tags!inner(tag_id)`)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  for (const t of transactions) {
    const links = (t as unknown as { transaction_tags: { tag_id: string }[] }).transaction_tags;
    tagsByTransaction.set(t.id, links.map((l) => l.tag_id));
  }
  const categoryOf = new Map(labels.subcategories.map((s) => [s.id, s.category_id]));
  return {
    tags,
    categoryOf,
    reports: new Map(tagReports(transactions, tagsByTransaction, tags, categoryOf).map((r) => [r.tagId, r])),
    categoryName: new Map(labels.subcategories.map((s) => [s.category_id, s.category])),
    subcategoryName: new Map(labels.subcategories.map((s) => [s.id, s.name])),
  };
}
