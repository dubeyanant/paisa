"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/icons";
import { inputClass } from "@/components/ui";
import type { AccountOption, FilterOptions, SubcategoryOption } from "@/lib/data/entries";
import {
  KIND_FILTERS,
  activeFilterCount,
  datePresets,
  describeRange,
  filtersQuery,
  type EntryFilters,
} from "@/lib/entry-filters";
import { formatINR, parseRupees, toRupeesInput } from "@/lib/finance/money";
import type { TransactionKind } from "@/lib/finance/types";

type Props = FilterOptions & {
  filters: EntryFilters;
  today: string;
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
  // The totals and the list, rendered on the server.
  children: React.ReactNode;
};

const TYPING_DELAY_MS = 350;

// Search, filters and the list they apply to (FR-8.3). Filters live in the
// URL, so a filtered list survives a reload and "back" returns to it. Every
// change updates the list and its totals together.
export function EntriesView({ filters, today, accounts, subcategories, buckets, tags, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(filters.q ?? "");
  // When the URL's search changes to something this box didn't just send, it
  // changed elsewhere (the browser's back button), and the box follows it.
  const [seenQ, setSeenQ] = useState(filters.q);
  const [sentQs, setSentQs] = useState<(string | undefined)[]>([]);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    const index = sentQs.indexOf(filters.q);
    if (index === -1) setText(filters.q ?? "");
    setSentQs(sentQs.slice(index + 1));
  }
  // The filters as last asked for, so quick changes build on each other.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  function apply(change: Partial<EntryFilters>) {
    const next = { ...latest.current, ...change };
    for (const key of Object.keys(next) as (keyof EntryFilters)[]) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    latest.current = next;
    const query = filtersQuery(next);
    startTransition(() => router.replace(query ? `/entries?${query}` : "/entries", { scroll: false }));
  }

  // Search as the owner types, once they pause.
  useEffect(() => {
    const q = text.trim() || undefined;
    if (q === latest.current.q) return;
    const timer = setTimeout(() => {
      setSentQs((sent) => [...sent, q]);
      apply({ q });
    }, TYPING_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply reads the latest filters itself
  }, [text]);

  const count = activeFilterCount(filters);
  const chips = describeFilters(filters, today, { accounts, subcategories, buckets, tags });
  const panel = (
    <FilterPanel
      filters={filters}
      today={today}
      accounts={accounts}
      subcategories={subcategories}
      buckets={buckets}
      tags={tags}
      apply={apply}
    />
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search</span>
            <SearchIcon className="pointer-events-none absolute inset-y-0 left-3 my-auto size-5 text-muted" />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search entries"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
              className={`${inputClass} pl-10`}
            />
          </label>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="entry-filters"
            className={`flex h-12 shrink-0 items-center gap-2 rounded-xl border px-3 font-medium transition-colors lg:hidden ${
              open || count > 0 ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface"
            }`}
          >
            <FilterIcon className="size-5" />
            <span className="max-[359px]:sr-only">Filters</span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </button>
        </div>

        {open && (
          <div id="entry-filters" className="rounded-2xl border border-line bg-surface p-4 lg:hidden">
            {panel}
          </div>
        )}

        {chips.length > 0 && !open && (
          <ul aria-label="Filters in use" className="flex flex-wrap gap-2 lg:hidden">
            {chips.map((chip) => (
              <li key={chip.label}>
                <button
                  type="button"
                  onClick={() => apply(chip.clear)}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="flex h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface pr-2 pl-3 text-sm"
                >
                  <span className="truncate">{chip.label}</span>
                  <CloseIcon className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div aria-busy={pending} className={`transition-opacity ${pending ? "opacity-60" : ""}`}>
          {children}
        </div>
      </div>

      <aside
        aria-label="Filters"
        className="sticky top-8 hidden max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-5 lg:block"
      >
        <h2 className="mb-4 font-semibold">Filters</h2>
        {panel}
      </aside>
    </div>
  );
}

type Options = FilterOptions & { accounts: AccountOption[]; subcategories: SubcategoryOption[] };

function FilterPanel({
  filters,
  today,
  apply,
  ...options
}: Options & { filters: EntryFilters; today: string; apply: (change: Partial<EntryFilters>) => void }) {
  const presets = datePresets(today);
  const preset = presets.find((p) => p.from === filters.from && p.to === filters.to);
  const [custom, setCustom] = useState(Boolean((filters.from || filters.to) && !preset));
  const when = preset?.id ?? (custom || filters.from || filters.to ? "custom" : "");
  const categories = categoryGroups(options.subcategories);
  const categoryValue = filters.subcategory ? `s:${filters.subcategory}` : filters.category ? `c:${filters.category}` : "";
  const active = options.accounts.filter((a) => !a.archived);
  const archived = options.accounts.filter((a) => a.archived);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-1">
      <Select
        label="When"
        value={when}
        onChange={(value) => {
          if (value === "custom") {
            setCustom(true);
            return;
          }
          setCustom(false);
          const p = presets.find((x) => x.id === value);
          apply({ from: p?.from, to: p?.to });
        }}
      >
        <option value="">Any time</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Choose dates…</option>
      </Select>

      {when === "custom" && (
        <div className="grid grid-cols-2 gap-3 col-span-2 lg:col-span-1">
          <DateField label="From" value={filters.from} onChange={(from) => apply({ from })} />
          <DateField label="To" value={filters.to} onChange={(to) => apply({ to })} />
        </div>
      )}

      <Select
        label="Kind"
        value={filters.kind ?? ""}
        onChange={(value) => apply({ kind: (value || undefined) as TransactionKind | undefined })}
      >
        <option value="">All</option>
        {KIND_FILTERS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </Select>

      <Select label="Account" value={filters.account ?? ""} onChange={(account) => apply({ account })}>
        <option value="">All</option>
        {active.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {archived.length > 0 && (
          <optgroup label="Archived">
            {archived.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>

      <Select
        label="Category"
        value={categoryValue}
        onChange={(value) =>
          apply({
            category: value.startsWith("c:") ? value.slice(2) : undefined,
            subcategory: value.startsWith("s:") ? value.slice(2) : undefined,
          })
        }
      >
        <option value="">All</option>
        {categories.map((c) => (
          <optgroup key={c.id} label={c.kind === "income" ? `${c.name} (income)` : c.name}>
            <option value={`c:${c.id}`}>All of {c.name}</option>
            {c.subcategories.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {options.buckets.length > 0 && (
        <Select label="Budget bucket" value={filters.bucket ?? ""} onChange={(bucket) => apply({ bucket })}>
          <option value="">All</option>
          {options.buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}

      {options.tags.length > 0 && (
        <Select label="Tag" value={filters.tag ?? ""} onChange={(tag) => apply({ tag })}>
          <option value="">All</option>
          {options.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}

      <fieldset className="col-span-2 lg:col-span-1">
        <legend className="mb-1.5 text-sm font-medium">Amount</legend>
        <div className="grid grid-cols-2 gap-3">
          <AmountField label="At least" value={filters.min} onChange={(min) => apply({ min })} />
          <AmountField label="At most" value={filters.max} onChange={(max) => apply({ max })} />
        </div>
      </fieldset>

      {activeFilterCount(filters) > 0 && (
        <button
          type="button"
          onClick={() => {
            setCustom(false);
            apply({
              from: undefined,
              to: undefined,
              account: undefined,
              category: undefined,
              subcategory: undefined,
              bucket: undefined,
              tag: undefined,
              kind: undefined,
              min: undefined,
              max: undefined,
            });
          }}
          className="col-span-2 h-11 w-fit text-sm font-medium text-accent lg:col-span-1"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} px-2`}>
        {children}
      </select>
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={`${inputClass} px-2`}
      />
    </label>
  );
}

// Applies when the owner leaves the field or presses Enter, not on every key.
function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const shown = value === undefined ? "" : toRupeesInput(value);
  const [draft, setDraft] = useState(shown);
  const [previous, setPrevious] = useState(shown);
  // Follow the URL when it changes from elsewhere, such as "Clear filters".
  if (shown !== previous) {
    setPrevious(shown);
    setDraft(shown);
  }

  function commit() {
    const paise = draft.trim() ? parseRupees(draft) : null;
    const next = paise ?? undefined;
    if (paise === null && draft.trim()) {
      setDraft(shown);
      return;
    }
    if (next !== value) onChange(next);
  }

  return (
    <label className="relative flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="pointer-events-none absolute bottom-0 left-3 flex h-12 items-center text-muted">₹</span>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`${inputClass} pl-7 tabular-nums`}
      />
    </label>
  );
}

type CategoryGroup = {
  id: string;
  name: string;
  kind: "expense" | "income";
  subcategories: SubcategoryOption[];
};

// Subcategories under their categories, spending first, in category order.
function categoryGroups(subcategories: SubcategoryOption[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const s of subcategories) {
    let group = groups.get(s.category_id);
    if (!group) {
      group = { id: s.category_id, name: s.category, kind: s.kind, subcategories: [] };
      groups.set(s.category_id, group);
    }
    group.subcategories.push(s);
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.kind === "expense"), ...all.filter((g) => g.kind === "income")];
}

// Each filter in use as a short label, and how to remove it.
function describeFilters(filters: EntryFilters, today: string, options: Options) {
  const chips: { label: string; clear: Partial<EntryFilters> }[] = [];
  if (filters.from || filters.to) {
    chips.push({ label: describeRange(filters.from, filters.to, today), clear: { from: undefined, to: undefined } });
  }
  if (filters.kind) {
    chips.push({ label: KIND_FILTERS.find((k) => k.kind === filters.kind)!.label, clear: { kind: undefined } });
  }
  const account = options.accounts.find((a) => a.id === filters.account);
  if (account) chips.push({ label: account.name, clear: { account: undefined } });
  const sub = options.subcategories.find((s) => s.id === filters.subcategory);
  if (sub) chips.push({ label: sub.name, clear: { subcategory: undefined } });
  const category = options.subcategories.find((s) => s.category_id === filters.category);
  if (category) chips.push({ label: `All of ${category.category}`, clear: { category: undefined } });
  const bucket = options.buckets.find((b) => b.id === filters.bucket);
  if (bucket) chips.push({ label: bucket.name, clear: { bucket: undefined } });
  const tag = options.tags.find((t) => t.id === filters.tag);
  if (tag) chips.push({ label: `#${tag.name}`, clear: { tag: undefined } });
  if (filters.min !== undefined || filters.max !== undefined) {
    const { min, max } = filters;
    const label =
      min !== undefined && max !== undefined
        ? `${formatINR(min)} – ${formatINR(max)}`
        : min !== undefined
          ? `${formatINR(min)} or more`
          : `Up to ${formatINR(max!)}`;
    chips.push({ label, clear: { min: undefined, max: undefined } });
  }
  return chips;
}
