"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import { parseEntry, type EntryInput } from "@/lib/entry";
import { createClient } from "@/lib/supabase/server";

export type EntryResult = { ok: true; ids: string[] } | { ok: false; error: string };

// Saves a new entry: one transaction per line (FR-2).
export async function saveEntry(input: EntryInput): Promise<EntryResult> {
  await requireUser();
  const parsed = parseEntry(input, new Date());
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await supabase.from("transactions").insert(parsed.rows);
  const ids = parsed.rows.map((r) => r.id);
  // The lines' ids come from the browser. If they're already taken, this is a
  // retry of a save that went through (the insert is all or nothing), so the
  // entry isn't saved twice.
  if (error?.code === "23505" && error.message.includes("transactions_pkey")) {
    return { ok: true, ids };
  }
  if (error) return { ok: false, error: saveErrorMessage(error.code, error.message) };

  revalidatePath("/", "layout");
  return { ok: true, ids };
}

// Changes an existing entry. It has a single line, whose id is the entry's.
export async function updateEntry(id: string, input: EntryInput): Promise<EntryResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: "That entry doesn't exist." };
  const parsed = parseEntry({ ...input, lines: input.lines.slice(0, 1).map((l) => ({ ...l, id })) }, new Date());
  if (!parsed.ok) return parsed;

  // Everything but the id.
  const changes = Object.fromEntries(Object.entries(parsed.rows[0]).filter(([key]) => key !== "id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("transactions").update(changes).eq("id", id).select("id");
  if (error) return { ok: false, error: saveErrorMessage(error.code, error.message) };
  if (data.length === 0) return { ok: false, error: "That entry doesn't exist any more." };

  revalidatePath("/", "layout");
  return { ok: true, ids: [id] };
}

// Deletes entries. The screens ask first (FR-2).
export async function deleteEntries(ids: string[]): Promise<EntryResult> {
  await requireUser();
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) {
    return { ok: false, error: "That entry doesn't exist." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().in("id", ids);
  if (error) {
    console.error("Deleting entries failed:", error.code, error.message);
    return { ok: false, error: "Couldn't delete. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, ids };
}

function saveErrorMessage(code: string | undefined, message: string) {
  // A foreign key: the account or category was deleted meanwhile.
  if (code === "23503") return "That account or category no longer exists. Reload and try again.";
  console.error("Saving an entry failed:", code, message);
  return "Couldn't save. Your entry is still here, so try again.";
}
