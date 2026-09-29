import Link from "next/link";
import { NavigationTracker } from "@/components/back";
import { BottomNav, SideNav } from "./nav";

// The signed-in app: side navigation on laptops, a bottom tab bar on phones.
// Each page still calls requireUser() itself (TD-10).
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-6 md:flex">
        <Link href="/" className="px-3 text-xl font-semibold tracking-tight">
          Paisa
        </Link>
        <SideNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-12">
          {children}
        </main>
      </div>
      <BottomNav />
      <NavigationTracker />
    </div>
  );
}
