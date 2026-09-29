// Logic behind the Budget screens (FR-7): checking a rule before it's saved,
// presets, and how a bucket's standing reads. The figures come from
// src/lib/finance/budget.ts.

import { ordinal } from "@/lib/accounts";
import { bucketProblem, type BucketAdherence } from "@/lib/finance/budget";
import { addDays, type Period } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";

export type RuleBucketInput = {
  // Names the bucket within the form; an existing bucket's key is its id.
  key: string;
  id: string | null;
  name: string;
  // Percent, as typed: "50", "33.33".
  share: string;
  holds_savings: boolean;
};

export type RuleInput = {
  name: string;
  base: "income" | "fixed";
  // Rupees, as typed. Only for a fixed base.
  fixed_base: string;
  buckets: RuleBucketInput[];
  // Removed bucket id → key of the bucket that takes its subcategories.
  moves: Record<string, string>;
};

export type RuleArgs = {
  new_name: string;
  new_base: "income" | "fixed";
  new_fixed_base: number | null;
  new_buckets: { key: string; id: string | null; name: string; share_bp: number; holds_savings: boolean }[];
  moves: Record<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "50" → 5000 basis points, "33.33" → 3333. null unless 0-100 with at most two
// decimals.
export function parseShare(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, "").trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

export function formatShare(bp: number): string {
  return `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

// Checks the rule form and turns it into save_budget_rule()'s arguments.
export function parseRule(input: RuleInput): { ok: true; args: RuleArgs } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return fail("Give the rule a name.");
  if (name.length > 60) return fail("Keep the rule's name to 60 characters or fewer.");

  if (input.base !== "income" && input.base !== "fixed") return fail("Choose what the rule divides up.");
  let fixed: number | null = null;
  if (input.base === "fixed") {
    fixed = parseRupees(String(input.fixed_base ?? ""));
    if (!fixed) return fail("Enter the monthly amount to divide up.");
  }

  const list = Array.isArray(input.buckets) ? input.buckets : [];
  const buckets: RuleArgs["new_buckets"] = [];
  for (const b of list) {
    const bucketName = String(b.name ?? "").trim().replace(/\s+/g, " ");
    if (bucketName.length > 40) return fail("Keep bucket names to 40 characters or fewer.");
    const share = parseShare(String(b.share ?? ""));
    if (share === null) return fail(`Enter ${bucketName || "each bucket"}'s share as a percentage, like 30 or 12.5.`);
    if (b.id !== null && !UUID.test(String(b.id))) return fail("Something went wrong. Reload and try again.");
    buckets.push({ key: String(b.key), id: b.id, name: bucketName, share_bp: share, holds_savings: Boolean(b.holds_savings) });
  }
  const problem = bucketProblem(buckets);
  if (problem) return fail(problem);
  const names = new Set(buckets.map((b) => b.name.toLowerCase()));
  if (names.size < buckets.length) return fail("Give each bucket a different name.");
  if (buckets.filter((b) => b.holds_savings).length > 1) return fail("Only one bucket can hold savings.");

  const keys = new Set(buckets.map((b) => b.key));
  const moves: Record<string, string> = {};
  for (const [from, to] of Object.entries(input.moves ?? {})) {
    if (UUID.test(from) && keys.has(to)) moves[from] = to;
  }
  return {
    ok: true,
    args: { new_name: name, new_base: input.base, new_fixed_base: fixed, new_buckets: buckets, moves },
  };
}

export const PRESETS = [
  { label: "50/30/20", shares: [50, 30, 20] },
  { label: "60/20/20", shares: [60, 20, 20] },
  { label: "70/20/10", shares: [70, 20, 10] },
];
const PRESET_NAMES = ["Needs", "Wants", "Savings"];

// A rule named like "50/30/20" is named after its shares, so the name follows
// them when they change. Any other name is the owner's and stays.
export function ruleName(name: string, buckets: Pick<RuleBucketInput, "share">[]): string {
  const trimmed = name.trim();
  if (trimmed && !/^\d+(\.\d+)?(\/\d+(\.\d+)?)+$/.test(trimmed)) return name;
  const shares = buckets.map((b) => parseShare(b.share));
  if (shares.some((s) => s === null)) return name;
  return shares.map((s) => String(s! / 100)).join("/");
}

// A preset's Needs, Wants and Savings buckets, reusing the current buckets of
// those names so their subcategories stay put.
export function applyPreset(current: RuleBucketInput[], shares: number[]): RuleBucketInput[] {
  return PRESET_NAMES.map((name, i) => {
    const existing = current.find((b) => b.name.trim().toLowerCase() === name.toLowerCase());
    return {
      key: existing?.key ?? `preset-${name}`,
      id: existing?.id ?? null,
      name,
      share: String(shares[i]),
      holds_savings: name === "Savings",
    };
  });
}

// How a bucket stands this month, in a few words.
export function statusLabel(b: Pick<BucketAdherence, "status" | "bucket">): string {
  if (b.status === "over") return "Over";
  if (b.status === "at_risk") return b.bucket.holds_savings ? "Behind" : "At risk";
  return "On track";
}

// "3rd month over" for a spending bucket, "2nd month short" for savings.
export function streakLabel(b: Pick<BucketAdherence, "streak" | "bucket">): string | null {
  if (b.streak < 2) return null;
  return `${ordinal(b.streak)} month ${b.bucket.holds_savings ? "short" : "over"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A budget month's name: "September 2026", or "3 Sep – 2 Oct" when budget
// months don't start on the 1st (FR-12). `short` gives "Sep 2026".
export function periodLabel(period: Period, short = false): string {
  const [year, month, day] = period.start.split("-").map(Number);
  if (day === 1) return `${(short ? MONTHS : LONG_MONTHS)[month - 1]} ${year}`;
  const [, endMonth, endDay] = addDays(period.end, -1).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} – ${endDay} ${MONTHS[endMonth - 1]}`;
}
