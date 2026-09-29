import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getEntry, getEntryContext } from "@/lib/data/entries";
import { EntryForm } from "../../add/entry-form";
import { entryFormProps } from "../../add/form-props";

export const metadata: Metadata = { title: "Edit entry · Paisa" };

export default async function EditEntryPage({ params }: PageProps<"/entries/[id]">) {
  const { id } = await params;
  const [entry, context] = await Promise.all([getEntry(id), getEntryContext()]);
  return (
    <>
      <PageHeader title="Edit entry" back={{ href: "/", label: "Back to home" }} />
      {entry.kind === "adjustment" ? (
        <p className="max-w-xl text-muted">
          This is a balance correction. It changes the account&apos;s balance only and can&apos;t be edited here.
        </p>
      ) : (
        <EntryForm key={entry.id} {...entryFormProps(context)} initial={{ mode: "edit", entry }} />
      )}
    </>
  );
}
