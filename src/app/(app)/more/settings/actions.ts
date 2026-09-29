"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { SMALL_SPEND_OPTIONS } from "@/lib/insights";
import { createClient } from "@/lib/supabase/server";

export type SettingsResult = { ok: true } | { ok: false; error: string };

type Setting = { budget_month_start_day?: number; small_spend_threshold?: number };

async function save(setting: Setting, what: string): Promise<SettingsResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").update(setting).eq("user_id", user.id).select("user_id");
  // Every user gets a settings row with their account (TD-13); make one if it's missing.
  const saved = !error && data.length > 0 ? { error: null } : await supabase.from("settings").insert(setting);
  if (error || saved.error) {
    const e = error ?? saved.error!;
    console.error(`Saving the ${what} failed:`, e.code, e.message);
    return { ok: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// The day budget months start (FR-12): 1 to 28, so every month has it.
export async function setMonthStartDay(day: number): Promise<SettingsResult> {
  if (!Number.isInteger(day) || day < 1 || day > 28) return { ok: false, error: "Choose a day from 1 to 28." };
  return save({ budget_month_start_day: day }, "month start day");
}

// What counts as a small spend for INS-06, in paise.
export async function setSmallSpendThreshold(paise: number): Promise<SettingsResult> {
  if (!SMALL_SPEND_OPTIONS.includes(paise)) return { ok: false, error: "Choose one of the amounts offered." };
  return save({ small_spend_threshold: paise }, "small-spend threshold");
}
