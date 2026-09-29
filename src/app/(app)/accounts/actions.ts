"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseAccountForm } from "@/lib/accounts";
import { isUuid } from "@/lib/data/accounts";
import { createClient } from "@/lib/supabase/server";

export type AccountFormState = { error: string } | undefined;

// Creates an account, or updates it when the form carries an id.
export async function saveAccount(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  await requireUser();
  const parsed = parseAccountForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const id = String(formData.get("id") ?? "");
  if (id && !isUuid(id)) return { error: "That account doesn't exist." };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("accounts").update(parsed.values).eq("id", id)
    : await supabase.from("accounts").insert(parsed.values);
  if (error) {
    if (error.code === "23505") {
      return { error: `You already have an account called "${parsed.values.name}".` };
    }
    console.error("Saving an account failed:", error.code, error.message);
    return { error: "Couldn't save the account. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/accounts");
}

// Archived accounts leave the entry screens but stay in every report (FR-1 AC2).
export async function setArchived(id: string, archived: boolean): Promise<AccountFormState> {
  await requireUser();
  if (!isUuid(id)) return { error: "That account doesn't exist." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) {
    console.error("Archiving an account failed:", error.code, error.message);
    return { error: "Couldn't update the account. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/accounts");
}

// Only an account with no entries can be deleted; the database refuses otherwise.
export async function deleteAccount(id: string): Promise<AccountFormState> {
  await requireUser();
  if (!isUuid(id)) return { error: "That account doesn't exist." };

  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { error: "This account has entries, so it can't be deleted. Archive it instead." };
    }
    console.error("Deleting an account failed:", error.code, error.message);
    return { error: "Couldn't delete the account. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/accounts");
}
