import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { getLabels } from "@/lib/data/entries";
import { getCommitment, getCommitmentPayments } from "@/lib/data/recurring";
import { addDays, istDate } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import { dueDates, recurringCost } from "@/lib/finance/recurring";
import { dayInSentence, describeSchedule } from "@/lib/recurring";
import { EntryList } from "../../../entry-list";
import { CommitmentForm } from "../commitment-form";
import { capitalise } from "../rows";
import { Skipped } from "./skipped";

export const metadata: Metadata = { title: "Commitment · Paisa" };

export default async function CommitmentPage({ params }: PageProps<"/more/recurring/[id]">) {
  const { id } = await params;
  const [commitment, payments, labels] = await Promise.all([getCommitment(id), getCommitmentPayments(id), getLabels()]);
  const today = istDate(new Date());
  const cost = recurringCost(commitment.amount, commitment);
  // The first due date after today; none once paused or ended.
  const next = dueDates(commitment, addDays(today, 800)).find((d) => d > today);
  const status = commitment.paused_at
    ? "Paused"
    : next
      ? `Next due ${dayInSentence(next, today)}`
      : "Ended";

  return (
    <>
      <PageHeader title={commitment.name} back={{ href: "/more/recurring", label: "Back to recurring" }} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="p-4 md:p-6">
            <p className="text-sm text-muted">
              {describeSchedule(commitment)} · {status}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <dt className="text-sm text-muted">Per month</dt>
                <dd className="truncate text-xl font-semibold tabular-nums">{formatINR(cost.monthly)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted">Per year</dt>
                <dd className="truncate text-xl font-semibold tabular-nums">{formatINR(cost.yearly)}</dd>
              </div>
            </dl>
            {commitment.is_variable && (
              <p className="mt-3 text-sm text-muted">Worked out from the usual amount, since it varies.</p>
            )}
          </Card>
          <CommitmentForm key={JSON.stringify(commitment)} {...labels} commitment={commitment} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {commitment.skipped_on.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Skipped</h2>
              <Skipped
                commitmentId={commitment.id}
                dates={[...commitment.skipped_on]
                  .reverse()
                  .map((date) => ({ date, label: capitalise(dayInSentence(date, today)) }))}
              />
            </section>
          )}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Payments</h2>
            {payments.length > 0 ? (
              <EntryList entries={payments} {...labels} showPlanned />
            ) : (
              <Card className="p-6 text-center text-sm text-muted">
                Payments you confirm from Due now show up here.
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
