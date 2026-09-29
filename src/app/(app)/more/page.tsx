import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signOut } from "../../login/actions";

export const metadata: Metadata = { title: "More · Paisa" };

const LINKS = [
  { href: "/budget", label: "Budget", hint: "Your rule, each bucket this month, and past months" },
  { href: "/more/recurring", label: "Recurring", hint: "Rent, bills and subscriptions, and what's due" },
  { href: "/more/categories", label: "Categories", hint: "Rename, hide, merge, and choose budget buckets" },
  { href: "/more/tags", label: "Tags", hint: "Trips and events, and what they cost" },
];

export default async function MorePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="More" />
      <div className="flex max-w-xl flex-col gap-6">
        <Card>
          <ul className="divide-y divide-line">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{link.label}</span>
                    <span className="block text-sm text-muted">{link.hint}</span>
                  </span>
                  <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4 md:p-6">
          <p className="text-sm text-muted">Signed in as</p>
          <p className="mt-0.5 truncate font-medium">{user.email}</p>
          <form action={signOut} className="mt-4">
            <button type="submit" className={buttonClass.secondary}>
              Sign out
            </button>
          </form>
          <p className="mt-3 text-sm text-muted">Signs out this device only.</p>
        </Card>
      </div>
    </>
  );
}
