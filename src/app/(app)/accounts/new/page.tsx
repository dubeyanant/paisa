import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { istDate } from "@/lib/finance/dates";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "Add account · Paisa" };

export default async function NewAccountPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Add account" back={{ href: "/accounts", label: "Back to accounts" }} />
      <AccountForm today={istDate(new Date())} />
    </>
  );
}
