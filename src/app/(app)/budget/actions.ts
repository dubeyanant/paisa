"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseRule, type RuleInput } from "@/lib/budget";
import { isUuid } from "@/lib/data/accounts";
import { createClient } from "@/lib/supabase/server";

export type RuleResult = { ok: true } | { ok: false; error: string };

// Saves the rule's name, base and buckets in one go (FR-7, TD-15). Every
// month's targets follow the new rule, history included (UAT-7).
export async function saveRule(ruleId: string, input: RuleInput): Promise<RuleResult> {
  await requireUser();
  if (!isUuid(ruleId)) return { ok: false, error: "That rule doesn't exist. Reload and try again." };
  const parsed = parseRule(input);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_budget_rule", { rule: ruleId, ...parsed.args });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: "That rule changed meanwhile. Reload and try again." };
    if (error.code === "23505") return { ok: false, error: "Give each bucket a different name." };
    console.error("Saving a budget rule failed:", error.code, error.message);
    return { ok: false, error: "Couldn't save the rule. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
