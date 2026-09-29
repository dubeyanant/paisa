"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountsIcon, EntriesIcon, HomeIcon, MoreIcon, PlusIcon } from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/entries", label: "Entries", Icon: EntriesIcon },
  { href: "/accounts", label: "Accounts", Icon: AccountsIcon },
  { href: "/more", label: "More", Icon: MoreIcon },
];

// One tap away on every screen (FR-2).
const ADD = { href: "/add", label: "Add", Icon: PlusIcon };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// Side navigation on laptops and tablets, with Add always at the top (FR-2).
export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      <Link
        href="/add"
        aria-current={pathname === "/add" ? "page" : undefined}
        className="mb-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-3 font-medium text-accent-foreground transition-opacity hover:opacity-90"
      >
        <PlusIcon className="size-5" />
        Add entry
      </Link>
      {ITEMS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// Bottom tab bar on phones, within reach of the thumb (NFR-1), with Add in the
// middle.
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-md">
        {[...ITEMS.slice(0, 2), ADD, ...ITEMS.slice(2)].map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          if (href === ADD.href) {
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-accent"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Icon className="size-6" />
                </span>
                {label}
              </Link>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon className="size-6" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
