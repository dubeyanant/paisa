import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { periodLabel } from "@/lib/budget";
import { getBudgetMonthStartDay } from "@/lib/data/recurring";
import { budgetMonthOf, istDate } from "@/lib/finance/dates";
import { MonthStart } from "./month-start";

export const metadata: Metadata = { title: "Settings · Paisa" };

export default async function SettingsPage() {
  const day = await getBudgetMonthStartDay();
  const month = budgetMonthOf(istDate(new Date()), day);
  return (
    <>
      <PageHeader title="Settings" back={{ href: "/more", label: "Back to more" }} />
      <div className="flex max-w-xl flex-col gap-6">
        <Card className="flex flex-col gap-3 p-4 md:p-6">
          <h2 className="font-semibold">Your month</h2>
          <p className="text-sm text-muted">
            Budgets, planned payments and what&rsquo;s free to spend count from this day, usually the day your salary
            comes in. Days 29 to 31 aren&rsquo;t offered, since not every month has them.
          </p>
          <MonthStart day={day} />
          <p className="text-sm text-muted">This month: {periodLabel(month)}.</p>
        </Card>
      </div>
    </>
  );
}
