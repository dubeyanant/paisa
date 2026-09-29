import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/data/accounts";
import { getActiveRule } from "@/lib/data/budget";
import { getLabels } from "@/lib/data/entries";
import { getBudgetMonthStartDay } from "@/lib/data/recurring";
import { budgetMonthOf, istDate } from "@/lib/finance/dates";
import { toRupeesInput } from "@/lib/finance/money";
import { isDate } from "@/lib/categories";
import { monthChoices } from "@/lib/funds";
import type { CommitmentInput } from "@/lib/recurring";
import { NewPlanned } from "./new-planned";

export const metadata: Metadata = { title: "Plan · Paisa" };

// A suggestion from the Planned screen arrives as query parameters, which
// fill in the form. Saving checks everything again.
function fromSuggestion(params: Record<string, string | string[] | undefined>): Partial<CommitmentInput> {
  const get = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const initial: Partial<CommitmentInput> = {};
  const name = get("name");
  if (name) initial.name = name.slice(0, 60);
  const kind = get("kind");
  if (kind === "expense" || kind === "transfer") initial.kind = kind;
  const amount = Number(get("amount"));
  if (Number.isSafeInteger(amount) && amount > 0) initial.amount = toRupeesInput(amount);
  for (const [key, field] of [
    ["account", "account_id"],
    ["to", "to_account_id"],
    ["sub", "subcategory_id"],
  ] as const) {
    const id = get(key);
    if (id && isUuid(id)) initial[field] = id;
  }
  const unit = get("unit");
  if (unit === "week" || unit === "month" || unit === "year") initial.unit = unit;
  const every = Number(get("every"));
  if (Number.isInteger(every) && every >= 1 && every <= 52) initial.every = every;
  const first = get("first");
  if (first && isDate(first)) initial.first_due_on = first;
  return initial;
}

// ?save=up opens on a new fund.
export default async function NewCommitmentPage({ searchParams }: PageProps<"/more/planned/new">) {
  const [labels, params, rule, startDay] = await Promise.all([getLabels(), searchParams, getActiveRule(), getBudgetMonthStartDay()]);
  const initial = fromSuggestion(params);
  const month = budgetMonthOf(istDate(new Date()), startDay);
  return (
    <>
      <PageHeader title="Plan" back={{ href: "/more/planned", label: "Back to planned" }} />
      <NewPlanned
        start={params.save === "up" ? "fund" : initial.unit ? "repeats" : "once"}
        {...labels}
        initial={initial}
        fund={{ buckets: rule?.buckets ?? [], months: monthChoices(month) }}
      />
    </>
  );
}
