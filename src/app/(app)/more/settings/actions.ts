"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SettingsResult = { ok: true } | { ok: false; error: string };

// The day budget months start (FR-12): 1 to 28, so every month has it.
export async function setMonthStartDay(day: number): Promise<SettingsResult> {
  const user = await requireUser();
  if (!Number.isInteger(day) || day < 1 || day > 28) return { ok: false, error: "Choose a day from 1 to 28." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").update({ budget_month_start_day: day }).eq("user_id", user.id).select("user_id");
  // Every user gets a settings row with their account (TD-13); make one if it's missing.
  const saved = !error && data.length > 0 ? { error: null } : await supabase.from("settings").insert({ budget_month_start_day: day });
  if (error || saved.error) {
    const e = error ?? saved.error!;
    console.error("Saving the month start day failed:", e.code, e.message);
    return { ok: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
