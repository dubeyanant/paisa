"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseName, parseTagDates } from "@/lib/categories";
import { isUuid } from "@/lib/data/accounts";
import { createClient } from "@/lib/supabase/server";

// Tags such as "Goa Trip" or "Diwali 2026" (FR-5).

export type TagResult = { ok: true; id: string } | { ok: false; error: string };

const MISSING = "That tag doesn't exist any more. Reload and try again.";

// Creates a tag. Dates are optional; with them, entries in that range are
// suggested for tagging, never tagged automatically.
export async function createTag(name: string, startsOn = "", endsOn = ""): Promise<TagResult> {
  await requireUser();
  const parsed = parseName(name, "tag");
  if (!parsed.ok) return parsed;
  const dates = parseTagDates(startsOn, endsOn);
  if (!dates.ok) return dates;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .insert({ name: parsed.name, ...dates.dates })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, error: `There's already a tag called "${parsed.name}".` };
  if (error) {
    console.error("Creating a tag failed:", error.code, error.message);
    return { ok: false, error: "Couldn't create the tag. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function updateTag(id: string, name: string, startsOn: string, endsOn: string): Promise<TagResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const parsed = parseName(name, "tag");
  if (!parsed.ok) return parsed;
  const dates = parseTagDates(startsOn, endsOn);
  if (!dates.ok) return dates;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .update({ name: parsed.name, ...dates.dates })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") return { ok: false, error: `There's already a tag called "${parsed.name}".` };
  if (error) {
    console.error("Updating a tag failed:", error.code, error.message);
    return { ok: false, error: "Couldn't save the tag. Please try again." };
  }
  if (data.length === 0) return { ok: false, error: MISSING };
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// Deletes the tag. Its entries stay; they just lose the tag.
export async function deleteTag(id: string): Promise<TagResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) {
    console.error("Deleting a tag failed:", error.code, error.message);
    return { ok: false, error: "Couldn't delete the tag. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// Tags the entries the owner picked from the suggestions.
export async function tagEntries(tagId: string, entryIds: string[]): Promise<TagResult> {
  await requireUser();
  if (!isUuid(tagId)) return { ok: false, error: MISSING };
  if (!Array.isArray(entryIds) || entryIds.length === 0 || entryIds.length > 500 || !entryIds.every(isUuid)) {
    return { ok: false, error: "Choose the entries to tag." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("transaction_tags")
    .upsert(
      entryIds.map((transaction_id) => ({ transaction_id, tag_id: tagId })),
      { onConflict: "transaction_id,tag_id", ignoreDuplicates: true },
    );
  if (error?.code === "23503") return { ok: false, error: "Some of those entries were deleted. Reload and try again." };
  if (error) {
    console.error("Tagging entries failed:", error.code, error.message);
    return { ok: false, error: "Couldn't tag the entries. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: tagId };
}
