// Checks behind the Categories and Tags screens (FR-4, FR-5).

// A trimmed name of 1 to `max` characters, as the database requires.
export function parseName(
  input: unknown,
  what: string,
  max = 60,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: `Give the ${what} a name.` };
  if (name.length > max) return { ok: false, error: `Keep the name to ${max} characters or fewer.` };
  return { ok: true, name };
}

// The order after moving `id` one place up or down among its siblings, or
// null if it can't move that way.
export function reorder(ids: string[], id: string, direction: "up" | "down"): string[] | null {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export type TagDates = { starts_on: string | null; ends_on: string | null };

// A tag's optional date range. Both dates or neither; a single date is a
// one-day range.
export function parseTagDates(
  startsOn: unknown,
  endsOn: unknown,
): { ok: true; dates: TagDates } | { ok: false; error: string } {
  const read = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  let starts_on = read(startsOn);
  let ends_on = read(endsOn);
  for (const date of [starts_on, ends_on]) {
    if (date !== null && !isDate(date)) return { ok: false, error: "Enter real dates, or leave them empty." };
  }
  if (starts_on && !ends_on) ends_on = starts_on;
  if (ends_on && !starts_on) starts_on = ends_on;
  if (starts_on && ends_on && ends_on < starts_on) {
    return { ok: false, error: "The end date is before the start date." };
  }
  return { ok: true, dates: { starts_on, ends_on } };
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// Whether to suggest a tag for an entry on this IST date: only tags with dates,
// and only within them. Never applied without the owner choosing (FR-5).
export function tagSuggested(tag: TagDates, date: string): boolean {
  return tag.starts_on !== null && tag.ends_on !== null && tag.starts_on <= date && date <= tag.ends_on;
}
