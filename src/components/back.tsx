"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeftIcon } from "@/components/icons";

// Whether this tab has moved between screens of the app since it loaded. Then
// "back" can return to the previous screen as it was, filters and scroll
// position included. After a reload, or on a shared link, it can't.
let navigatedInApp = false;

// Goes in the app layout and notices moves between screens.
export function NavigationTracker() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) navigatedInApp = true;
  }, [pathname]);
  return null;
}

// Returns to the previous screen, or goes to `fallback` if there isn't one.
export function useGoBack(fallback: string) {
  const router = useRouter();
  return () => {
    if (navigatedInApp) router.back();
    else router.push(fallback);
  };
}

export function BackLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  const goBack = useGoBack(href);
  return (
    <Link
      href={href}
      aria-label={label}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        goBack();
      }}
      className={`-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-foreground/5 hover:text-foreground ${className}`}
    >
      <ArrowLeftIcon />
    </Link>
  );
}
