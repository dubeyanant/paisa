"use client";

import { useState, useTransition } from "react";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Card, buttonClass, inputClass } from "@/components/ui";
import type { CategoryRow, CategoryTree, SubcategoryRow } from "@/lib/data/categories";
import {
  addCategory,
  addSubcategory,
  merge,
  move,
  moveToCategory,
  remove,
  renameCategory,
  renameSubcategory,
  setBucket,
  setHidden,
  type CategoryResult,
} from "./actions";

type Kind = "expense" | "income";
// What's open for editing: a category, a subcategory, or a form to add one.
type Open =
  | { type: "category" | "subcategory" | "add-subcategory"; id: string }
  | { type: "add-category" }
  | null;

// Add, rename, hide, reorder, merge and delete categories and subcategories,
// and choose each subcategory's budget bucket (FR-4).
export function CategoriesManager({ categories, buckets }: CategoryTree) {
  const [kind, setKind] = useState<Kind>("expense");
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const shown = categories.filter((c) => c.kind === kind);
  const bucketName = new Map(buckets.map((b) => [b.id, b.name]));

  function toggle(next: Open) {
    setError(undefined);
    setOpen((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next));
  }

  // Runs a change; `after` runs when it worked.
  function run(task: () => Promise<CategoryResult>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      let result: CategoryResult;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) after?.();
      else setError(result.error);
    });
  }

  const shared = { pending, error, run, close: () => setOpen(null) };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div role="radiogroup" aria-label="Kind of category" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1">
        {(
          [
            ["expense", "Spending"],
            ["income", "Income"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setOpen(null);
            }}
            className={`h-10 rounded-lg text-sm font-medium transition-colors ${
              kind === k ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "expense" && (
        <p className="text-sm text-muted">
          Each subcategory counts in one budget bucket. Changing it changes every month&apos;s figures.
        </p>
      )}

      {shown.map((category, index) => (
        <Card key={category.id} className={category.hidden ? "opacity-70" : ""}>
          <Row
            title={category.name}
            badges={category.hidden ? ["Hidden"] : []}
            heading
            expanded={open?.type === "category" && open.id === category.id}
            onClick={() => toggle({ type: "category", id: category.id })}
          />
          {open?.type === "category" && open.id === category.id && (
            <CategoryEditor
              category={category}
              first={index === 0}
              last={index === shown.length - 1}
              others={shown.filter((c) => c.id !== category.id)}
              {...shared}
            />
          )}
          <ul className="divide-y divide-line border-t border-line">
            {category.subcategories.map((sub, subIndex) => {
              const isOpen = open?.type === "subcategory" && open.id === sub.id;
              return (
                <li key={sub.id}>
                  <Row
                    title={sub.name}
                    badges={[...(sub.hidden ? ["Hidden"] : []), ...(sub.is_system ? ["Can't be deleted"] : [])]}
                    detail={kind === "expense" ? (sub.bucket_id ? bucketName.get(sub.bucket_id) : "No bucket") : undefined}
                    expanded={isOpen}
                    onClick={() => toggle({ type: "subcategory", id: sub.id })}
                  />
                  {isOpen && (
                    <SubcategoryEditor
                      sub={sub}
                      category={category}
                      first={subIndex === 0}
                      last={subIndex === category.subcategories.length - 1}
                      categories={shown}
                      buckets={kind === "expense" ? buckets : []}
                      {...shared}
                    />
                  )}
                </li>
              );
            })}
            <li>
              {open?.type === "add-subcategory" && open.id === category.id ? (
                <AddForm
                  label={`New subcategory in ${category.name}`}
                  buckets={kind === "expense" ? buckets : []}
                  onAdd={(name, bucket) => run(() => addSubcategory(category.id, name, bucket), () => setOpen(null))}
                  {...shared}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => toggle({ type: "add-subcategory", id: category.id })}
                  className="flex h-12 w-full items-center gap-2 rounded-b-2xl px-4 text-sm font-medium text-accent hover:bg-foreground/[0.03]"
                >
                  <PlusIcon className="size-5" />
                  Add subcategory
                </button>
              )}
            </li>
          </ul>
        </Card>
      ))}

      {open?.type === "add-category" ? (
        <Card>
          <AddForm
            label={kind === "expense" ? "New spending category" : "New income category"}
            buckets={[]}
            onAdd={(name) => run(() => addCategory(kind, name), () => setOpen(null))}
            {...shared}
          />
        </Card>
      ) : (
        <button type="button" onClick={() => toggle({ type: "add-category" })} className={`${buttonClass.secondary} w-fit`}>
          <PlusIcon className="size-5" />
          Add category
        </button>
      )}
    </div>
  );
}

type Shared = {
  pending: boolean;
  error: string | undefined;
  run: (task: () => Promise<CategoryResult>, after?: () => void) => void;
  close: () => void;
};

function Row({
  title,
  badges,
  detail,
  heading = false,
  expanded,
  onClick,
}: {
  title: string;
  badges: string[];
  detail?: string;
  heading?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={`flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.03] ${
        heading ? "rounded-t-2xl" : ""
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`min-w-0 truncate ${heading ? "font-semibold" : ""}`}>{title}</span>
        {badges.map((b) => (
          <span key={b} className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-xs font-medium text-muted">
            {b}
          </span>
        ))}
      </span>
      {detail && <span className="shrink-0 text-sm text-muted">{detail}</span>}
      <ChevronRightIcon className={`-mr-1 size-5 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
    </button>
  );
}

function Editor({ children, error }: { children: React.ReactNode; error: string | undefined }) {
  return (
    <div className="flex flex-col gap-4 border-t border-line bg-foreground/[0.02] px-4 py-4">
      {children}
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

function CategoryEditor({
  category,
  first,
  last,
  others,
  pending,
  error,
  run,
  close,
}: Shared & { category: CategoryRow; first: boolean; last: boolean; others: CategoryRow[] }) {
  return (
    <Editor error={error}>
      <RenameField
        value={category.name}
        pending={pending}
        onSave={(name) => run(() => renameCategory(category.id, name))}
      />
      <div className="flex flex-wrap gap-2">
        <MoveButtons first={first} last={last} pending={pending} onMove={(d) => run(() => move("categories", category.id, d))} />
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setHidden("categories", category.id, !category.hidden))}
          className={buttonClass.secondary}
        >
          {category.hidden ? "Show" : "Hide"}
        </button>
      </div>
      {category.hidden ? (
        <p className="text-sm text-muted">Hidden: it&apos;s left off the Add screen, and stays in every report.</p>
      ) : (
        <p className="text-sm text-muted">Hiding leaves it off the Add screen. Its entries stay in every report.</p>
      )}
      {others.length > 0 && (
        <MergeField
          what="category"
          name={category.name}
          options={others.map((c) => ({ id: c.id, label: c.name }))}
          note="Its subcategories move across. One with the same name as a subcategory there is merged into it."
          pending={pending}
          onMerge={(target) => run(() => merge("category", category.id, target), close)}
        />
      )}
      {category.subcategories.length === 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm(`Delete "${category.name}"?`)) run(() => remove("category", category.id), close);
          }}
          className={`${buttonClass.danger} w-fit`}
        >
          Delete category
        </button>
      )}
    </Editor>
  );
}

function SubcategoryEditor({
  sub,
  category,
  first,
  last,
  categories,
  buckets,
  pending,
  error,
  run,
  close,
}: Shared & {
  sub: SubcategoryRow;
  category: CategoryRow;
  first: boolean;
  last: boolean;
  categories: CategoryRow[];
  buckets: { id: string; name: string }[];
}) {
  const mergeOptions = categories.flatMap((c) =>
    c.subcategories.filter((s) => s.id !== sub.id).map((s) => ({ id: s.id, label: s.name, group: c.name })),
  );
  return (
    <Editor error={error}>
      <RenameField value={sub.name} pending={pending} onSave={(name) => run(() => renameSubcategory(sub.id, name))} />

      {buckets.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Budget bucket</span>
          <select
            value={sub.bucket_id ?? ""}
            disabled={pending}
            onChange={(e) => e.target.value && run(() => setBucket(sub.id, e.target.value))}
            className={`${inputClass} px-2`}
          >
            {!sub.bucket_id && <option value="">Choose…</option>}
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {categories.length > 1 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Category</span>
          <select
            value={category.id}
            disabled={pending}
            onChange={(e) => run(() => moveToCategory(sub.id, e.target.value))}
            className={`${inputClass} px-2`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <MoveButtons first={first} last={last} pending={pending} onMove={(d) => run(() => move("subcategories", sub.id, d))} />
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setHidden("subcategories", sub.id, !sub.hidden))}
          className={buttonClass.secondary}
        >
          {sub.hidden ? "Show" : "Hide"}
        </button>
      </div>

      {!sub.is_system && mergeOptions.length > 0 && (
        <MergeField
          what="subcategory"
          name={sub.name}
          options={mergeOptions}
          note="Every entry and recurring bill moves across, in every month's figures."
          pending={pending}
          onMerge={(target) => run(() => merge("subcategory", sub.id, target), close)}
        />
      )}

      {sub.is_system ? (
        <p className="text-sm text-muted">For money you can&apos;t account for. It can be renamed, but not deleted or merged away.</p>
      ) : (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete "${sub.name}"?`)) run(() => remove("subcategory", sub.id), close);
            }}
            className={buttonClass.danger}
          >
            Delete
          </button>
          <p className="mt-2 text-sm text-muted">Only while no entry uses it. Otherwise merge it or hide it.</p>
        </div>
      )}
    </Editor>
  );
}

function RenameField({ value, pending, onSave }: { value: string; pending: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() !== value) onSave(name);
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor="rename" className="text-sm font-medium">
        Name
      </label>
      <div className="flex gap-2">
        <input
          id="rename"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="off"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="submit" disabled={pending || name.trim() === value} className={`${buttonClass.secondary} h-12`}>
          Rename
        </button>
      </div>
    </form>
  );
}

function MoveButtons({
  first,
  last,
  pending,
  onMove,
}: {
  first: boolean;
  last: boolean;
  pending: boolean;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <>
      <button type="button" disabled={pending || first} onClick={() => onMove("up")} className={buttonClass.secondary}>
        Move up
      </button>
      <button type="button" disabled={pending || last} onClick={() => onMove("down")} className={buttonClass.secondary}>
        Move down
      </button>
    </>
  );
}

function MergeField({
  what,
  name,
  options,
  note,
  pending,
  onMerge,
}: {
  what: "category" | "subcategory";
  name: string;
  options: { id: string; label: string; group?: string }[];
  note: string;
  pending: boolean;
  onMerge: (targetId: string) => void;
}) {
  const [target, setTarget] = useState("");
  const groups = new Map<string, typeof options>();
  for (const o of options) groups.set(o.group ?? "", [...(groups.get(o.group ?? "") ?? []), o]);
  const targetLabel = options.find((o) => o.id === target)?.label;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`merge-${what}`} className="text-sm font-medium">
        Merge into
      </label>
      <div className="flex gap-2">
        <select
          id={`merge-${what}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={`${inputClass} min-w-0 flex-1 px-2`}
        >
          <option value="">Choose…</option>
          {[...groups].map(([group, list]) =>
            group ? (
              <optgroup key={group} label={group}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              list.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))
            ),
          )}
        </select>
        <button
          type="button"
          disabled={pending || !target}
          onClick={() => {
            if (confirm(`Merge "${name}" into "${targetLabel}"? "${name}" is then deleted. This can't be undone.`)) {
              onMerge(target);
            }
          }}
          className={`${buttonClass.secondary} h-12`}
        >
          Merge
        </button>
      </div>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}

function AddForm({
  label,
  buckets,
  onAdd,
  pending,
  error,
  close,
}: Pick<Shared, "pending" | "error" | "close"> & {
  label: string;
  buckets: { id: string; name: string }[];
  onAdd: (name: string, bucketId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [bucket, setBucketId] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name, bucket || null);
      }}
      className="flex flex-col gap-3 px-4 py-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          autoComplete="off"
          className={inputClass}
        />
      </label>
      {buckets.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Budget bucket</span>
          <select value={bucket} onChange={(e) => setBucketId(e.target.value)} className={`${inputClass} px-2`}>
            <option value="">Choose…</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={close} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
