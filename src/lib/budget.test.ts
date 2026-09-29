import { describe, expect, test } from "bun:test";
import { applyPreset, formatShare, parseRule, periodLabel, ruleName, parseShare, statusLabel, streakLabel, type RuleInput } from "./budget";

const NEEDS = "11111111-1111-4111-8111-111111111111";
const WANTS = "22222222-2222-4222-8222-222222222222";
const SAVINGS = "33333333-3333-4333-8333-333333333333";

const rule: RuleInput = {
  name: " My rule ",
  base: "income",
  fixed_base: "",
  buckets: [
    { key: NEEDS, id: NEEDS, name: "Needs", share: "50", holds_savings: false },
    { key: WANTS, id: WANTS, name: "Wants", share: "30", holds_savings: false },
    { key: SAVINGS, id: SAVINGS, name: "Savings", share: "20%", holds_savings: true },
  ],
  moves: {},
};

test("parseShare and formatShare", () => {
  expect(parseShare("50")).toBe(5000);
  expect(parseShare("33.33")).toBe(3333);
  expect(parseShare("12.5 %")).toBe(1250);
  expect(parseShare("100.01")).toBeNull();
  expect(parseShare("1.234")).toBeNull();
  expect(parseShare("")).toBeNull();
  expect(formatShare(3333)).toBe("33.33%");
  expect(formatShare(5000)).toBe("50%");
});

describe("parseRule", () => {
  const error = (changes: Partial<RuleInput>) => {
    const parsed = parseRule({ ...rule, ...changes });
    return parsed.ok ? null : parsed.error;
  };

  test("turns the form into the function's arguments", () => {
    const parsed = parseRule({ ...rule, base: "fixed", fixed_base: "60,000", moves: { [WANTS]: NEEDS, junk: NEEDS } });
    expect(parsed).toEqual({
      ok: true,
      args: {
        new_name: "My rule",
        new_base: "fixed",
        new_fixed_base: 6000000,
        new_buckets: [
          { key: NEEDS, id: NEEDS, name: "Needs", share_bp: 5000, holds_savings: false },
          { key: WANTS, id: WANTS, name: "Wants", share_bp: 3000, holds_savings: false },
          { key: SAVINGS, id: SAVINGS, name: "Savings", share_bp: 2000, holds_savings: true },
        ],
        moves: { [WANTS]: NEEDS },
      },
    });
  });

  test("a 4-bucket rule adding up to 95% is blocked with a clear message (FR-7 AC2)", () => {
    const buckets = [
      { ...rule.buckets[0], share: "45" },
      rule.buckets[1],
      { ...rule.buckets[2], share: "10" },
      { key: "new", id: null, name: "Family", share: "10", holds_savings: false },
    ];
    expect(error({ buckets })).toBe("The shares add up to 95%. They must add up to 100%.");
    expect(error({ buckets: buckets.map((b, i) => (i === 3 ? { ...b, share: "0" } : b)) })).toBe(
      "Every bucket needs a share above 0%.",
    );
  });

  test("rejects what the database would", () => {
    expect(error({ name: "" })).toBe("Give the rule a name.");
    expect(error({ base: "fixed", fixed_base: "" })).toBe("Enter the monthly amount to divide up.");
    expect(error({ buckets: rule.buckets.slice(0, 1).map((b) => ({ ...b, share: "100" })) })).toBe(
      "A rule needs 2 to 6 buckets. This one has 1.",
    );
    expect(error({ buckets: rule.buckets.map((b, i) => (i === 1 ? { ...b, name: "needs" } : b)) })).toBe(
      "Give each bucket a different name.",
    );
    expect(error({ buckets: rule.buckets.map((b) => ({ ...b, holds_savings: true })) })).toBe(
      "Only one bucket can hold savings.",
    );
    expect(error({ buckets: rule.buckets.map((b, i) => (i === 0 ? { ...b, share: "half" } : b)) })).toBe(
      "Enter Needs's share as a percentage, like 30 or 12.5.",
    );
  });
});

test("applyPreset keeps the buckets it can, by name", () => {
  const custom = [
    { key: NEEDS, id: NEEDS, name: "needs", share: "55", holds_savings: false },
    { key: "fun", id: WANTS, name: "Fun", share: "25", holds_savings: false },
    { key: SAVINGS, id: SAVINGS, name: "Savings", share: "20", holds_savings: true },
  ];
  expect(applyPreset(custom, [60, 20, 20])).toEqual([
    { key: NEEDS, id: NEEDS, name: "Needs", share: "60", holds_savings: false },
    { key: "preset-Wants", id: null, name: "Wants", share: "20", holds_savings: false },
    { key: SAVINGS, id: SAVINGS, name: "Savings", share: "20", holds_savings: true },
  ]);
});

test("status and streak wording (INS-17)", () => {
  const wants = { id: "w", name: "Wants", share_bp: 3000, holds_savings: false };
  const savings = { id: "s", name: "Savings", share_bp: 2000, holds_savings: true };
  expect(statusLabel({ status: "over", bucket: wants })).toBe("Over");
  expect(statusLabel({ status: "at_risk", bucket: wants })).toBe("At risk");
  expect(statusLabel({ status: "at_risk", bucket: savings })).toBe("Behind");
  expect(statusLabel({ status: "on_track", bucket: savings })).toBe("On track");
  expect(streakLabel({ streak: 3, bucket: wants })).toBe("3rd month over");
  expect(streakLabel({ streak: 2, bucket: savings })).toBe("2nd month short");
  expect(streakLabel({ streak: 1, bucket: wants })).toBeNull();
});

test("periodLabel", () => {
  expect(periodLabel({ start: "2026-09-01", end: "2026-10-01" })).toBe("September 2026");
  expect(periodLabel({ start: "2026-09-01", end: "2026-10-01" }, true)).toBe("Sep 2026");
  expect(periodLabel({ start: "2026-09-03", end: "2026-10-03" })).toBe("3 Sep – 2 Oct");
});

test("ruleName follows the shares only for a name made of shares", () => {
  const shares = [{ share: "55" }, { share: "25" }, { share: "20" }];
  expect(ruleName("60/20/20", shares)).toBe("55/25/20");
  expect(ruleName("", [{ share: "62.5" }, { share: "37.5" }])).toBe("62.5/37.5");
  expect(ruleName("My plan", shares)).toBe("My plan");
  expect(ruleName("50/30/20", [{ share: "abc" }, { share: "50" }])).toBe("50/30/20");
});
