import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getAccount } from "@/lib/data/accounts";
import { istDate } from "@/lib/finance/dates";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "Edit account · Paisa" };

export default async function EditAccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const { account, entryCount } = await getAccount(id);
  return (
    <>
      <PageHeader title={account.name} back={{ href: "/accounts", label: "Back to accounts" }} />
      <AccountForm account={account} entryCount={entryCount} today={istDate(new Date())} />
    </>
  );
}
