"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isOwedType, parseAccountForm } from "@/lib/accounts";
import { isUuid } from "@/lib/data/accounts";
import { parseSignedRupees } from "@/lib/finance/money";
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

export type CorrectionResult = { ok: true; amount: number } | { ok: false; error: string };

// Sets an account's balance to what it really is now, by recording the
// difference as a balance correction. A correction changes the balance only,
// never spending, income or saving (BR-13). For a card or loan, `actual` is
// the amount owed.
export async function correctBalance(id: string, actual: string): Promise<CorrectionResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: "That account doesn't exist." };
  const amount = parseSignedRupees(String(actual ?? ""));
  if (amount === null) return { ok: false, error: "Enter the balance, like 12500 or -250.50." };

  const supabase = await createClient();
  const [account, balance] = await Promise.all([
    supabase.from("accounts").select("type, opening_balance").eq("id", id).maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", id).maybeSingle(),
  ]);
  if (account.error || balance.error) {
    console.error("Reading a balance failed:", account.error ?? balance.error);
    return { ok: false, error: "Couldn't correct the balance. Please try again." };
  }
  if (!account.data) return { ok: false, error: "That account doesn't exist." };

  const current = Number(balance.data?.balance ?? account.data.opening_balance);
  const target = isOwedType(account.data.type) ? 0 - amount : amount;
  const difference = target - current;
  if (difference === 0) return { ok: false, error: "That's already the balance, so nothing changed." };

  const { error } = await supabase.from("transactions").insert({
    kind: "adjustment",
    amount: difference,
    account_id: id,
    occurred_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Correcting a balance failed:", error.code, error.message);
    return { ok: false, error: "Couldn't correct the balance. Please try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true, amount: difference };
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
