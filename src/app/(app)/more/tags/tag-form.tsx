"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import type { TagRow } from "@/lib/data/categories";
import { createTag, deleteTag, updateTag, type TagResult } from "./actions";

// Creates a tag, or edits one when `tag` is given.
export function TagForm({ tag, onDone }: { tag?: TagRow; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(tag?.name ?? "");
  const [startsOn, setStartsOn] = useState(tag?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(tag?.ends_on ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<TagResult>, after: (result: Extract<TagResult, { ok: true }>) => void) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      let result: TagResult;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) after(result);
      else setError(result.error);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (tag) {
      run(() => updateTag(tag.id, name, startsOn, endsOn), () => setSaved(true));
    } else {
      run(() => createTag(name, startsOn, endsOn), (result) => {
        onDone?.();
        router.push(`/more/tags/${result.id}`);
      });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="Goa Trip"
          className={inputClass}
        />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">
          Dates <span className="font-normal text-muted">· Optional</span>
        </legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-muted">From</span>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={`${inputClass} px-2`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-muted">To</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={`${inputClass} px-2`} />
          </label>
        </div>
        <p className="mt-2 text-sm text-muted">
          With dates, entries from those days are suggested for this tag. Nothing is tagged until you choose.
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-accent">
          Saved.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Saving…" : tag ? "Save changes" : "Create tag"}
        </button>
        {tag && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete the tag "${tag.name}"? Its entries stay; they just lose the tag.`)) {
                run(() => deleteTag(tag.id), () => router.push("/more/tags"));
              }
            }}
            className={buttonClass.danger}
          >
            Delete tag
          </button>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className={buttonClass.secondary}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
