import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { formatINR } from "@/lib/finance/money";

export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  // Where the back arrow goes, on screens below the top level.
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex min-h-11 items-center gap-2 md:mb-8">
      {back && (
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeftIcon />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h1>
      {action}
    </header>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</section>
  );
}

export const buttonClass = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 font-medium transition-colors hover:bg-foreground/5 disabled:opacity-60",
  danger:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 font-medium text-negative transition-colors hover:bg-negative/10 disabled:opacity-60",
};

export const inputClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

// An amount in rupees; negative ones in red.
export function Amount({ value }: { value: number }) {
  return <span className={value < 0 ? "text-negative" : undefined}>{formatINR(value)}</span>;
}
