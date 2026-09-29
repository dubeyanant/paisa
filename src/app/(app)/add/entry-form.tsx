"use client";

import { useRouter } from "next/navigation";
import { useGoBack } from "@/components/back";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PlusIcon } from "@/components/icons";
import { buttonClass, inputClass } from "@/components/ui";
import { tagSuggested } from "@/lib/categories";
import type { AccountOption, Entry, SubcategoryOption, TagOption } from "@/lib/data/entries";
import {
  ENTRY_KINDS,
  MAX_LINES,
  categoryKindOf,
  normalizeNote,
  transferLabel,
  type EntryInput,
  type EntryKind,
  type QuickPick,
} from "@/lib/entry";
import { istDate, toIstDateTimeInput } from "@/lib/finance/dates";
import { formatINR, parseRupees, toRupeesInput } from "@/lib/finance/money";
import { createTag } from "../more/tags/actions";
import { deleteEntries, saveEntry, updateEntry, type EntryResult } from "./actions";

export type EntryFormProps = {
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
  // Newest first.
  tags: TagOption[];
  picks: QuickPick[];
  frequent: { expense: string[]; income: string[] };
  // [category kind + "|" + normalised note, subcategory id]
  notes: [string, string][];
  defaultAccountId: string | null;
  // Edit an entry, or start a new one from a copy of it.
  initial?: { mode: "edit" | "duplicate"; entry: Entry };
};

type Line = {
  id: string;
  amount: string;
  subcategory_id: string | null;
  note: string;
  // The category was filled in from a remembered note, so a new note may replace it.
  autoCategory: boolean;
};

const newLine = (fields: Partial<Line> = {}): Line => ({
  id: crypto.randomUUID(),
  amount: "",
  subcategory_id: null,
  note: "",
  autoCategory: false,
  ...fields,
});

type Saved = { text: string; ids: string[] };

export function EntryForm(props: EntryFormProps) {
  const { accounts, subcategories, picks, frequent, defaultAccountId, initial } = props;
  const router = useRouter();
  // After saving or deleting an edit, back to the list it was opened from.
  const goBack = useGoBack("/entries");
  const editing = initial?.mode === "edit" ? initial.entry : undefined;
  const source = initial?.entry;

  const [kind, setKind] = useState<EntryKind>(
    source && source.kind !== "adjustment" ? source.kind : "expense",
  );
  const [accountId, setAccountId] = useState(source?.account_id ?? defaultAccountId ?? "");
  const [toAccountId, setToAccountId] = useState<string | null>(source?.to_account_id ?? null);
  const [lines, setLines] = useState<Line[]>(() => [
    source
      ? newLine({
          id: editing?.id ?? crypto.randomUUID(),
          amount: toRupeesInput(source.amount),
          subcategory_id: source.subcategory_id,
          note: source.note ?? "",
        })
      : newLine(),
  ]);
  // null means "now": the moment Save is pressed. A copy starts at now.
  const [when, setWhen] = useState<string | null>(editing ? toIstDateTimeInput(editing.occurred_at) : null);
  const [description, setDescription] = useState(source?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(source?.description));
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>(source?.tag_ids ?? []);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<Saved>();
  const [pending, startTransition] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const subById = useMemo(() => new Map(subcategories.map((s) => [s.id, s])), [subcategories]);
  const noteMemory = useMemo(() => new Map(props.notes), [props.notes]);

  // Archived accounts and hidden categories stay off the choices, except the
  // ones an entry being edited or copied already uses.
  const accountChoices = accounts.filter(
    (a) => !a.archived || a.id === source?.account_id || a.id === source?.to_account_id,
  );
  // Expenses, income and refunds are nearly always on bank, cash or card
  // accounts, so the others wait behind "Other accounts".
  const everyday = (a: AccountOption) =>
    a.type === "bank" || a.type === "wallet" || a.type === "credit_card" || a.id === accountId;
  const fromChoices =
    kind === "transfer" || showAllAccounts ? accountChoices : accountChoices.filter(everyday);
  const hiddenAccounts = accountChoices.length - fromChoices.length;
  const categoryKind = categoryKindOf(kind);
  const subChoices = subcategories.filter(
    (s) => s.kind === categoryKind && (!s.hidden || s.id === source?.subcategory_id),
  );

  useEffect(() => {
    if (!initial) amountRef.current?.focus();
  }, [initial]);

  const toType = toAccountId ? accountById.get(toAccountId)?.type : undefined;
  const action = kind === "transfer" ? transferLabel(toType) : "Save";
  const total = lines.reduce((sum, l) => sum + (parseRupees(l.amount) ?? 0), 0);
  const kindPicks = picks.filter((p) => p.kind === kind).slice(0, 6);

  function updateLine(index: number, change: Partial<Line>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...change } : l)));
  }

  function changeKind(next: EntryKind) {
    // Categories belong to expenses or income, so they don't carry across.
    if (categoryKindOf(next) !== categoryKind) {
      setLines((current) => current.map((l) => ({ ...l, subcategory_id: null, autoCategory: false })));
    }
    if (next === "transfer") setLines((current) => current.slice(0, 1));
    setKind(next);
    setError(undefined);
  }

  function changeNote(index: number, note: string) {
    const line = lines[index];
    const remembered = categoryKind ? noteMemory.get(`${categoryKind}|${normalizeNote(note)}`) : undefined;
    if (remembered && (line.subcategory_id === null || line.autoCategory)) {
      updateLine(index, { note, subcategory_id: remembered, autoCategory: true });
    } else {
      updateLine(index, { note });
    }
  }

  function applyPick(pick: QuickPick) {
    setAccountId(pick.account_id);
    setToAccountId(pick.to_account_id);
    updateLine(0, {
      subcategory_id: pick.subcategory_id,
      note: pick.note ?? "",
      autoCategory: false,
      // The owner may have typed the amount first; keep it.
      amount: lines[0].amount.trim() ? lines[0].amount : toRupeesInput(pick.amount),
    });
    setError(undefined);
  }

  function input(): EntryInput {
    return {
      kind,
      account_id: accountId,
      to_account_id: kind === "transfer" ? toAccountId : null,
      occurred_at: when,
      description,
      lines: lines.map(({ id, amount, subcategory_id, note }) => ({ id, amount, subcategory_id, note })),
      tag_ids: tagIds,
    };
  }

  function run(task: () => Promise<EntryResult>, onDone: (result: Extract<EntryResult, { ok: true }>) => void) {
    setError(undefined);
    startTransition(async () => {
      let result: EntryResult;
      try {
        result = await task();
      } catch {
        // The request never got an answer, for example with no signal (TD-14).
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection; your entry is still here." };
      }
      if (result.ok) onDone(result);
      else setError(result.error);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (editing) {
      run(() => updateEntry(editing.id, input()), goBack);
      return;
    }
    const summary = describeSaved();
    run(() => saveEntry(input()), (result) => {
      setSaved({ text: summary, ids: result.ids });
      // Ready for the next entry, on the same account.
      setLines([newLine()]);
      setWhen(null);
      setDescription("");
      setShowDescription(false);
      setShowAllCategories(false);
      setTagIds([]);
      amountRef.current?.focus();
      router.refresh();
    });
  }

  function describeSaved() {
    const amount = formatINR(total);
    if (kind === "transfer") {
      const to = toAccountId ? accountById.get(toAccountId)?.name : "";
      return `${transferLabel(toType)} ${amount} to ${to}`;
    }
    if (lines.length > 1) return `${lines.length} entries, ${amount} in all`;
    const line = lines[0];
    return `${line.note.trim() || subById.get(line.subcategory_id ?? "")?.name || "Entry"} ${amount}`;
  }

  function undo() {
    if (!saved) return;
    const ids = saved.ids;
    run(() => deleteEntries(ids), () => {
      setSaved(undefined);
      router.refresh();
    });
  }

  function remove() {
    if (!editing || !confirm("Delete this entry? This can't be undone.")) return;
    run(() => deleteEntries([editing.id]), goBack);
  }

  function duplicate() {
    if (editing) router.push(`/add?copy=${editing.id}`);
  }

  const futureWhen = when !== null && when > toIstDateTimeInput(new Date());

  const accountFields = (
    <>
      <Field label={kind === "transfer" ? "From" : "Account"}>
        <Choices
          options={fromChoices.map((a) => ({ id: a.id, label: a.name }))}
          selected={accountId}
          onSelect={(id) => {
            setAccountId(id);
            if (id === toAccountId) setToAccountId(null);
          }}
        />
        {hiddenAccounts > 0 && (
          <button type="button" onClick={() => setShowAllAccounts(true)} className="mt-1 h-11 w-fit text-sm font-medium text-accent">
            Other accounts ({hiddenAccounts})
          </button>
        )}
      </Field>

      {kind === "transfer" && (
        <Field label="To">
          <Choices
            options={accountChoices.filter((a) => a.id !== accountId).map((a) => ({ id: a.id, label: a.name }))}
            selected={toAccountId}
            onSelect={setToAccountId}
          />
          {(toType === "credit_card" || toType === "loan") && (
            <p className="mt-2 text-sm text-muted">
              {toType === "loan" ? "Repaying a loan" : "Paying a card bill"} isn&apos;t spending: it moves money you already have.
            </p>
          )}
        </Field>
      )}
    </>
  );

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-6">
      {saved && (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 text-accent">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Saved.</span> {saved.text}
          </p>
          <button type="button" onClick={undo} disabled={pending} className="h-9 shrink-0 rounded-lg px-3 text-sm font-medium hover:bg-accent/10">
            Undo
          </button>
        </div>
      )}

      <div role="radiogroup" aria-label="Kind of entry" className="grid grid-cols-4 gap-1 rounded-xl bg-foreground/[0.06] p-1">
        {ENTRY_KINDS.map(({ kind: k, label }) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => changeKind(k)}
            className={`h-10 rounded-lg text-sm font-medium transition-colors ${
              kind === k ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{lines.length > 1 ? "Line 1" : "Amount"}</span>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-2xl text-muted">₹</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            aria-label="Amount in rupees"
            value={lines[0].amount}
            onChange={(e) => updateLine(0, { amount: e.target.value })}
            className={`${inputClass} h-16 pl-10 text-3xl font-semibold tabular-nums`}
          />
        </div>
      </label>

      {kindPicks.length > 0 && !editing && (
        <section aria-label="Quick picks">
          <h2 className="mb-2 text-sm font-medium">Quick picks</h2>
          <div className="flex flex-wrap gap-2">
            {kindPicks.map((pick) => (
              <button
                key={[pick.subcategory_id, pick.account_id, pick.to_account_id, pick.note].join("|")}
                type="button"
                onClick={() => applyPick(pick)}
                className="min-h-11 rounded-xl border border-line bg-surface px-3 py-1.5 text-left text-sm leading-tight transition-colors hover:border-accent"
              >
                <span className="font-medium">{pickTitle(pick)}</span>{" "}
                <span className="tabular-nums">{formatINR(pick.amount)}</span>
                <span className="block text-xs text-muted">{pickAccounts(pick)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {categoryKind && (
        <section aria-label="Category">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">Category</h2>
            <button
              type="button"
              onClick={() => setShowAllCategories((v) => !v)}
              className="text-sm font-medium text-accent"
            >
              {showAllCategories ? "Fewer" : "All categories"}
            </button>
          </div>
          <CategoryChips
            options={showAllCategories ? subChoices : frequentChoices(frequent[categoryKind], subChoices, lines[0].subcategory_id)}
            grouped={showAllCategories}
            selected={lines[0].subcategory_id}
            onSelect={(id) => {
              updateLine(0, { subcategory_id: id, autoCategory: false });
              setShowAllCategories(false);
            }}
          />
        </section>
      )}

      {kind === "transfer" && accountFields}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Note <span className="font-normal text-muted">· Optional</span>
        </span>
        <input
          value={lines[0].note}
          onChange={(e) => changeNote(0, e.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder={kind === "transfer" ? "Card bill" : "Lunch"}
          className={inputClass}
        />
      </label>

      {lines.slice(1).map((line, i) => (
        <ExtraLine
          key={line.id}
          number={i + 2}
          line={line}
          subChoices={subChoices}
          onChange={(change) => updateLine(i + 1, change)}
          onNote={(note) => changeNote(i + 1, note)}
          onRemove={() => setLines((current) => current.filter((l) => l.id !== line.id))}
        />
      ))}

      {!editing && kind !== "transfer" && lines.length < MAX_LINES && (
        <button type="button" onClick={() => setLines((current) => [...current, newLine()])} className={`${buttonClass.secondary} w-fit`}>
          <PlusIcon className="size-5" />
          Add another line
        </button>
      )}

      {/* Shared by every line, so it comes after them. */}
      {kind !== "transfer" && accountFields}

      <Field label="When">
        {when === null ? (
          <div className="flex items-center gap-3">
            <span className="text-[15px]">Now</span>
            <button type="button" onClick={() => setWhen(toIstDateTimeInput(new Date()))} className="h-11 text-sm font-medium text-accent">
              Change
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="datetime-local"
              aria-label="Date and time"
              value={when}
              onChange={(e) => setWhen(e.target.value || null)}
              className={`${inputClass} max-w-64`}
            />
            {!editing && (
              <button type="button" onClick={() => setWhen(null)} className="h-11 shrink-0 text-sm font-medium text-accent">
                Now
              </button>
            )}
          </div>
        )}
        {futureWhen && <p className="mt-2 text-sm text-muted">A future date saves this as planned. It won&apos;t count until then.</p>}
      </Field>

      <TagPicker
        tags={props.tags}
        selected={tagIds}
        onChange={setTagIds}
        // Suggestions follow the entry's date (FR-5).
        date={when === null ? istDate(new Date()) : when.slice(0, 10)}
      />

      {showDescription ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            className={`${inputClass} h-auto py-2.5`}
          />
        </label>
      ) : (
        <button type="button" onClick={() => setShowDescription(true)} className="h-11 w-fit text-sm font-medium text-accent">
          Add a description
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap gap-3 md:bottom-6">
        <button type="submit" disabled={pending} className={`${buttonClass.primary} h-12 flex-1 text-base shadow-lg sm:flex-none sm:px-10`}>
          {pending ? "Saving…" : `${editing ? "Save changes" : action}${total > 0 ? ` ${formatINR(total)}` : ""}`}
        </button>
      </div>

      {editing && (
        <section className="flex flex-wrap gap-3 border-t border-line pt-6">
          <button type="button" onClick={duplicate} disabled={pending} className={buttonClass.secondary}>
            Duplicate
          </button>
          <button type="button" onClick={remove} disabled={pending} className={buttonClass.danger}>
            Delete
          </button>
        </section>
      )}
    </form>
  );

  function pickTitle(pick: QuickPick) {
    if (pick.kind === "transfer") {
      return pick.note ?? `${transferLabel(accountById.get(pick.to_account_id ?? "")?.type)}`;
    }
    return pick.note ?? subById.get(pick.subcategory_id ?? "")?.name ?? "";
  }

  function pickAccounts(pick: QuickPick) {
    const from = accountById.get(pick.account_id)?.name;
    if (pick.kind !== "transfer") return from;
    return `${from} → ${accountById.get(pick.to_account_id ?? "")?.name}`;
  }
}

// The subcategories used most, plus the chosen one if it isn't among them.
function frequentChoices(frequentIds: string[], choices: SubcategoryOption[], selected: string | null) {
  const byId = new Map(choices.map((s) => [s.id, s]));
  const ids = frequentIds.filter((id) => byId.has(id));
  if (selected && byId.has(selected) && !ids.includes(selected)) ids.unshift(selected);
  // A new account has no history yet: start with the first few.
  if (ids.length === 0) return choices.slice(0, 8);
  return ids.map((id) => byId.get(id)!);
}

function CategoryChips({
  options,
  grouped,
  selected,
  onSelect,
}: {
  options: SubcategoryOption[];
  grouped: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!grouped) {
    return <Choices options={options.map((s) => ({ id: s.id, label: s.name }))} selected={selected} onSelect={onSelect} />;
  }
  const groups = new Map<string, SubcategoryOption[]>();
  for (const s of options) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      {[...groups].map(([category, subs]) => (
        <div key={category}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{category}</h3>
          <Choices options={subs.map((s) => ({ id: s.id, label: s.name }))} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

function Choices({
  options,
  selected,
  onSelect,
}: {
  options: { id: string; label: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={selected === o.id}
          onClick={() => onSelect(o.id)}
          className={`min-h-11 rounded-xl border px-3 text-[15px] transition-colors ${
            selected === o.id
              ? "border-accent bg-accent-soft font-medium text-accent"
              : "border-line bg-surface hover:border-accent"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ExtraLine({
  number,
  line,
  subChoices,
  onChange,
  onNote,
  onRemove,
}: {
  number: number;
  line: Line;
  subChoices: SubcategoryOption[];
  onChange: (change: Partial<Line>) => void;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const groups = new Map<string, SubcategoryOption[]>();
  for (const s of subChoices) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">Line {number}</legend>
        <button type="button" onClick={onRemove} className="h-9 rounded-lg px-2 text-sm font-medium text-negative hover:bg-negative/10">
          Remove
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            aria-label={`Amount on line ${number}`}
            value={line.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            className={`${inputClass} pl-7 tabular-nums`}
          />
        </div>
        <select
          aria-label={`Category on line ${number}`}
          value={line.subcategory_id ?? ""}
          onChange={(e) => onChange({ subcategory_id: e.target.value || null, autoCategory: false })}
          className={`${inputClass} px-2`}
        >
          <option value="">Category…</option>
          {[...groups].map(([category, subs]) => (
            <optgroup key={category} label={category}>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <input
        value={line.note}
        onChange={(e) => onNote(e.target.value)}
        maxLength={200}
        autoComplete="off"
        placeholder="Note (optional)"
        aria-label={`Note on line ${number}`}
        className={inputClass}
      />
    </fieldset>
  );
}

// Tags for the entry (FR-5). Tags whose dates cover the entry's date are
// suggested, but only added when tapped.
function TagPicker({
  tags,
  selected,
  onChange,
  date,
}: {
  tags: TagOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  date: string;
}) {
  const [open, setOpen] = useState(selected.length > 0);
  const [showAll, setShowAll] = useState(false);
  // Made here, before the screen reloads with them.
  const [created, setCreated] = useState<TagOption[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const all = [...created.filter((c) => !tags.some((t) => t.id === c.id)), ...tags];
  const suggested = all.filter((t) => tagSuggested(t, date));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  function create() {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await createTag(name);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setCreated((c) => [{ id: result.id, name: name.trim(), starts_on: null, ends_on: null }, ...c]);
        onChange([...selected, result.id]);
        setName("");
      } catch {
        setError("Couldn't reach Paisa. Check your connection and try again.");
      }
    });
  }

  if (!open) {
    const offer = suggested.filter((t) => !selected.includes(t.id));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="h-11 text-sm font-medium text-accent">
          Add a tag
        </button>
        {offer.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => {
              toggle(tag.id);
              setOpen(true);
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-accent px-3 text-sm"
          >
            <PlusIcon className="size-4 text-accent" />
            {tag.name}
            <span className="text-xs text-muted">Suggested</span>
          </button>
        ))}
      </div>
    );
  }

  // Selected and suggested first, then the newest few, or every tag.
  const first = all.filter((t) => selected.includes(t.id) || suggested.includes(t));
  const rest = all.filter((t) => !first.includes(t));
  const shown = [...first, ...(showAll ? rest : rest.slice(0, Math.max(0, 8 - first.length)))];
  const hiddenCount = all.length - shown.length;

  return (
    <section aria-label="Tags" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        Tags <span className="font-normal text-muted">· Optional</span>
      </h2>
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shown.map((tag) => {
            const on = selected.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(tag.id)}
                className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-[15px] transition-colors ${
                  on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface hover:border-accent"
                }`}
              >
                {tag.name}
                {!on && suggested.includes(tag) && <span className="text-xs text-muted">Suggested</span>}
              </button>
            );
          })}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="h-11 px-1 text-sm font-medium text-accent">
              All tags ({all.length})
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (name.trim()) create();
            }
          }}
          maxLength={60}
          autoComplete="off"
          placeholder="New tag, like Goa Trip"
          aria-label="New tag"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="button" onClick={create} disabled={pending || !name.trim()} className={`${buttonClass.secondary} h-12`}>
          {pending ? "Adding…" : "Add tag"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
