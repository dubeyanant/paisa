import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getEntry, getEntryContext } from "@/lib/data/entries";
import { EntryForm } from "./entry-form";
import { entryFormProps } from "./form-props";

export const metadata: Metadata = { title: "Add · Paisa" };

// ?copy=<id> starts from a copy of an existing entry (FR-2 "Duplicate").
export default async function AddPage({ searchParams }: PageProps<"/add">) {
  const { copy } = await searchParams;
  const [context, source] = await Promise.all([
    getEntryContext(),
    typeof copy === "string" ? getEntry(copy) : undefined,
  ]);
  return (
    <>
      <PageHeader title={source ? "Add a copy" : "Add"} />
      <EntryForm
        key={source?.id ?? "new"}
        {...entryFormProps(context)}
        initial={source ? { mode: "duplicate", entry: source } : undefined}
      />
    </>
  );
}
