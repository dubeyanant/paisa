import { BackLink } from "@/components/back";
import { formatINR } from "@/lib/finance/money";

export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  // Where the back arrow goes, on screens below the top level, when there's
  // no previous screen to return to.
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex min-h-11 items-center gap-2 md:mb-8">
      {back && <BackLink {...back} />}
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

// An amount in rupees; negative ones in red, others in `className` (a colour
// for the kind of money, like text-planned).
export function Amount({ value, className }: { value: number; className?: string }) {
  return <span className={value < 0 ? "text-negative" : className}>{formatINR(value)}</span>;
}
