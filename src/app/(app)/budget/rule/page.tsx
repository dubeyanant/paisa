import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getActiveRule } from "@/lib/data/budget";
import { toRupeesInput } from "@/lib/finance/money";
import { RuleForm } from "./rule-form";

export const metadata: Metadata = { title: "Budget rule · Paisa" };

export default async function RulePage() {
  const rule = await getActiveRule();
  if (!rule) notFound();
  const counts: Record<string, number> = {};
  for (const bucket of rule.assignments.values()) counts[bucket] = (counts[bucket] ?? 0) + 1;
  return (
    <>
      <PageHeader title="Budget rule" back={{ href: "/budget", label: "Back to budget" }} />
      <RuleForm
        ruleId={rule.id}
        counts={counts}
        initial={{
          name: rule.name,
          base: rule.base,
          fixed_base: rule.fixed_base ? toRupeesInput(rule.fixed_base) : "",
          buckets: rule.buckets.map((b) => ({
            key: b.id,
            id: b.id,
            name: b.name,
            share: String(b.share_bp / 100),
            holds_savings: b.holds_savings,
          })),
          moves: {},
        }}
      />
    </>
  );
}
