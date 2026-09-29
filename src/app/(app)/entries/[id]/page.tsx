import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getActiveRule } from "@/lib/data/budget";
import { getEntry, getEntryContext } from "@/lib/data/entries";
import { EntryForm } from "../../add/entry-form";
import { entryFormProps } from "../../add/form-props";
import { Correction } from "./correction";

export const metadata: Metadata = { title: "Edit entry · Paisa" };

export default async function EditEntryPage({ params }: PageProps<"/entries/[id]">) {
  const { id } = await params;
  const [entry, context, rule] = await Promise.all([getEntry(id), getEntryContext(), getActiveRule()]);
  const budget = rule
    ? { buckets: rule.buckets.map(({ id, name }) => ({ id, name })), assignments: [...rule.assignments] }
    : undefined;
  return (
    <>
      <PageHeader
        title={entry.kind === "adjustment" ? "Balance correction" : "Edit entry"}
        back={{ href: "/entries", label: "Back to entries" }}
      />
      {entry.kind === "adjustment" ? (
        <Correction entry={entry} account={context.accounts.find((a) => a.id === entry.account_id)} />
      ) : (
        <EntryForm key={entry.id} {...entryFormProps(context)} initial={{ mode: "edit", entry }} budget={budget} />
      )}
    </>
  );
}
