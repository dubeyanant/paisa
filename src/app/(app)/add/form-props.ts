import "server-only";
import type { EntryContext } from "@/lib/data/entries";
import { defaultAccount, frequentSubcategories, noteMemory, quickPicks } from "@/lib/entry";
import type { EntryFormProps } from "./entry-form";

// Works out the Add screen's suggestions on the server, so the browser gets
// the results, not the history behind them.
export function entryFormProps({ accounts, subcategories, recent, tags, funds }: EntryContext): Omit<EntryFormProps, "initial"> {
  const active = accounts.filter((a) => !a.archived).map((a) => a.id);
  const usable = {
    accounts: new Set(active),
    subcategories: new Set(subcategories.filter((s) => !s.hidden).map((s) => s.id)),
  };
  return {
    accounts,
    subcategories,
    tags,
    funds,
    // Up to 6 per kind are shown.
    picks: quickPicks(recent, usable, { limit: 24 }),
    frequent: {
      expense: frequentSubcategories(recent, "expense", usable),
      income: frequentSubcategories(recent, "income", usable),
    },
    notes: [...noteMemory(recent, usable)],
    defaultAccountId: defaultAccount(recent, active),
  };
}
