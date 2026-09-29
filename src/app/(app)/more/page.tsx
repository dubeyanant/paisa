import type { Metadata } from "next";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signOut } from "../../login/actions";

export const metadata: Metadata = { title: "More · Paisa" };

export default async function MorePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="More" />
      <Card className="max-w-xl p-4 md:p-6">
        <p className="text-sm text-muted">Signed in as</p>
        <p className="mt-0.5 truncate font-medium">{user.email}</p>
        <form action={signOut} className="mt-4">
          <button type="submit" className={buttonClass.secondary}>
            Sign out
          </button>
        </form>
        <p className="mt-3 text-sm text-muted">Signs out this device only.</p>
      </Card>
    </>
  );
}
