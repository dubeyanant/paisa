import { describe, expect, test } from "bun:test";
import { bucketActuals, budgetAdherence } from "./budget";
import { budgetMonthOf, istStartOf } from "./dates";
import { account, at, byId, tx } from "./fixtures";
import {
  finishedMonths,
  fundBudget,
  fundState,
  fundStates,
  heldInFunds,
  savedBefore,
  withoutCovered,
  type Fund,
  type FundMove,
} from "./funds";
import type { BudgetBucket, Transaction } from "./types";

// Made-up funds (TD-6). Budget months start on the 1st unless a test says otherwise.
const phone: Fund = {
  id: "phone",
  kind: "goal",
  bucket_id: "wants",
  target: 6000000, // ₹60,000 over October to January
  monthly_amount: null,
  cap: null,
  schedule_from: "2026-10-01",
  ends_on: "2027-01-15",
  closed_at: null,
};

const clothes: Fund = {
  id: "clothes",
  kind: "ongoing",
  bucket_id: "wants",
  target: null,
  monthly_amount: 200000, // ₹2,000 a month, up to ₹5,000
  cap: 500000,
  schedule_from: "2026-10-01",
  ends_on: null,
  closed_at: null,
};

const noon = (date: string) => new Date(at(date));
const move = (fund_id: string, amount: number, date: string): FundMove => ({
  fund_id,
  amount,
  occurred_at: at(date),
  is_monthly: false,
});
const spend = (fund_id: string, amount: number, date: string, fields: Partial<Transaction> = {}) =>
  tx({ kind: "expense", amount, subcategory_id: "gadgets", occurred_at: at(date), fund_id, ...fields });
const monthly = (s: ReturnType<typeof fundState>) =>
  s.events.flatMap((e) => (e.type === "monthly" ? [e.amount] : []));

describe("a goal", () => {
  test("saves its target in even shares, one each budget month", () => {
    const s = fundState(phone, [], [], 1, noon("2026-11-15"));
    expect(monthly(s)).toEqual([1500000, 1500000]);
    expect(s.balance).toBe(3000000);
    expect(s.thisMonth).toBe(1500000);
    expect(s.monthsLeft).toBe(3); // November, December, January
    expect(s.events[0].at).toBe(istStartOf("2026-10-01").toISOString());
  });

  test("rounds a share up to the rupee, and the last month takes what's left", () => {
    const s = fundState({ ...phone, target: 1000000, ends_on: "2026-12-01" }, [], [], 1, noon("2027-02-01"));
    expect(monthly(s)).toEqual([333400, 333300, 333300]);
    expect(s.balance).toBe(1000000);
    expect(s.monthsLeft).toBe(0);
  });

  test("money added by hand lowers the months after it", () => {
    const s = fundState(phone, [move("phone", 1500000, "2026-10-20")], [], 1, noon("2026-11-15"));
    expect(monthly(s)).toEqual([1500000, 1000000]); // ₹30,000 left over 3 months
    expect(s.balance).toBe(4000000);
  });

  test("stops saving once the target is reached", () => {
    const s = fundState(phone, [move("phone", 6000000, "2026-09-20")], [], 1, noon("2026-12-15"));
    expect(monthly(s)).toEqual([]);
    expect(s.balance).toBe(6000000);
  });

  test("stays open after spends, and keeps saving toward its target without refilling", () => {
    // ₹40,000 spent in December of the ₹45,000 saved; January still puts in its ₹15,000.
    const s = fundState(phone, [], [spend("phone", 4000000, "2026-12-10")], 1, noon("2027-01-20"));
    expect(s.events.map((e) => e.type)).toEqual(["monthly", "monthly", "monthly", "spend", "monthly"]);
    expect(s.events[3]).toMatchObject({ covered: 4000000 });
    expect(s.closedAt).toBeNull();
    expect(s.saved).toBe(6000000);
    expect(s.spent).toBe(4000000);
    expect(s.balance).toBe(2000000);
    // Once the target is in, nothing more goes in, however much is spent.
    const after = fundState(phone, [], [spend("phone", 6000000, "2027-01-25")], 1, noon("2027-03-05"));
    expect(monthly(after)).toEqual([1500000, 1500000, 1500000, 1500000]);
    expect(after.balance).toBe(0);
  });

  test("spent early or for more: it covers what it holds, and the rest counts as usual", () => {
    const s = fundState(phone, [], [spend("phone", 7000000, "2026-11-10")], 1, noon("2026-12-15"));
    expect(s.events.find((e) => e.type === "spend")).toMatchObject({ covered: 3000000 });
    expect(monthly(s)).toEqual([1500000, 1500000, 1500000]);
    expect(s.balance).toBe(1500000);
  });

  test("closing it by hand frees what it holds", () => {
    const s = fundState({ ...phone, closed_at: at("2026-12-20") }, [], [spend("phone", 4000000, "2026-12-10")], 1, noon("2027-01-20"));
    expect(s.events.map((e) => e.type)).toEqual(["monthly", "monthly", "monthly", "spend", "release"]);
    expect(s.events[4]).toMatchObject({ amount: -500000 });
    expect(s.balance).toBe(0);
    expect(s.thisMonth).toBe(0);
  });

  test("a budget month starting on the 21st", () => {
    const s = fundState({ ...phone, schedule_from: "2026-09-25", ends_on: "2026-11-25" }, [], [], 21, noon("2026-10-22"));
    // September 21 to October 20 and October 21 to November 20 so far, of 3.
    expect(s.events.map((e) => e.at)).toEqual([istStartOf("2026-09-21").toISOString(), istStartOf("2026-10-21").toISOString()]);
    expect(monthly(s)).toEqual([2000000, 2000000]);
    expect(s.monthsLeft).toBe(2);
  });
});

describe("a recurring fund", () => {
  test("saves its monthly amount up to its cap, and fills back up once spent from", () => {
    const s = fundState(clothes, [], [spend("clothes", 300000, "2027-01-10")], 1, noon("2027-02-05"));
    // October ₹2,000, November ₹2,000, December ₹1,000 to reach ₹5,000, January nothing.
    // After ₹3,000 of clothes, February tops it up by ₹2,000 of the ₹3,000 of room.
    expect(monthly(s)).toEqual([200000, 200000, 100000, 200000]);
    expect(s.balance).toBe(400000);
  });

  test("covers only what it holds", () => {
    const s = fundState(clothes, [], [spend("clothes", 300000, "2026-10-10")], 1, noon("2026-10-20"));
    expect(s.events.find((e) => e.type === "spend")).toMatchObject({ covered: 200000 });
    expect(s.balance).toBe(0);
  });

  test("takes back a refund, and stays open after spends", () => {
    const shirt = spend("clothes", 150000, "2026-10-10");
    const back = tx({ kind: "refund", amount: 150000, subcategory_id: "gadgets", occurred_at: at("2026-10-12"), fund_id: "clothes" });
    const s = fundState(clothes, [], [shirt, back], 1, noon("2026-10-20"));
    expect(s.events.filter((e) => e.type === "spend").map((e) => e.type === "spend" && e.covered)).toEqual([150000, -150000]);
    expect(s.balance).toBe(200000);
    expect(s.closedAt).toBeNull();
  });

  test("money can be taken out by hand", () => {
    const s = fundState(clothes, [move("clothes", -50000, "2026-10-15")], [], 1, noon("2026-10-20"));
    expect(s.balance).toBe(150000);
  });

  test("closing it frees what it holds, and nothing goes in or is covered after", () => {
    const closed = { ...clothes, closed_at: at("2026-11-10") };
    const s = fundState(closed, [], [spend("clothes", 100000, "2026-12-10")], 1, noon("2026-12-20"));
    expect(s.events.map((e) => e.type)).toEqual(["monthly", "monthly", "release", "spend"]);
    expect(s.events.at(-1)).toMatchObject({ covered: 0 });
    expect(s.balance).toBe(0);
  });

  test("with no monthly amount, it holds only what's added", () => {
    const s = fundState({ ...clothes, monthly_amount: null, cap: null }, [move("clothes", 1000000, "2026-10-05")], [], 1, noon("2026-12-01"));
    expect(monthly(s)).toEqual([]);
    expect(s.balance).toBe(1000000);
  });

  test("leaves out planned spends and anything after now", () => {
    const planned = spend("clothes", 100000, "2026-10-10", { is_planned: true });
    const later = spend("clothes", 100000, "2026-10-25");
    const s = fundState(clothes, [move("clothes", 100000, "2026-10-25")], [planned, later], 1, noon("2026-10-20"));
    expect(s.events.map((e) => e.type)).toEqual(["monthly"]);
    expect(s.balance).toBe(200000);
  });
});

describe("with the rest of the money", () => {
  const spends = [spend("phone", 4000000, "2026-12-10"), spend("clothes", 300000, "2026-11-10")];
  // The phone fund is closed once bought, freeing the ₹5,000 left.
  const closedPhone = { ...phone, closed_at: at("2026-12-12") };
  const states = fundStates([closedPhone, clothes], [], spends, 1, noon("2026-12-15"));

  test("each fund gets its own moves and spends, and their balances are held back", () => {
    const [p, c] = states;
    expect(p.balance).toBe(0);
    expect(c.balance).toBe(100000 + 200000); // ₹4,000 by November, ₹3,000 spent, then December's ₹2,000
    expect(heldInFunds(states)).toBe(300000);
  });

  test("the budget counts money into funds when it goes in, and not the part of a spend they covered", () => {
    const budget = fundBudget(states);
    const buckets: BudgetBucket[] = [
      { id: "needs", name: "Needs", share_bp: 5000, holds_savings: false },
      { id: "wants", name: "Wants", share_bp: 3000, holds_savings: false },
      { id: "savings", name: "Savings", share_bp: 2000, holds_savings: true },
    ];
    const rule = { buckets, assignments: new Map([["gadgets", "wants"]]) };
    const accounts = byId([account("bank", "bank")]);
    const coffee = tx({ kind: "expense", amount: 20000, subcategory_id: "gadgets", occurred_at: at("2026-12-11") });
    const december = budgetMonthOf("2026-12-15");

    // ₹15,000 into the phone and ₹2,000 into clothes, minus ₹5,000 freed when
    // the phone fund closed, and the coffee. The phone itself was paid from the fund.
    const counted = [...withoutCovered([...spends, coffee], budget), ...budget.contributions];
    expect(bucketActuals(counted, rule, accounts, december).byBucket.get("wants")).toBe(1500000 + 200000 - 500000 + 20000);

    // November: ₹15,000 and ₹2,000 in. The fund held ₹4,000, so it covered all ₹3,000 of clothes.
    const november = budgetMonthOf("2026-11-15");
    expect(bucketActuals(counted, rule, accounts, november).byBucket.get("wants")).toBe(1500000 + 200000);

    // Over the phone's life, Wants counted exactly what it cost.
    const phoneOnly = fundBudget([states[0]]);
    const life = { start: "2026-10-01", end: "2027-02-01" };
    expect(bucketActuals(withoutCovered([spends[0]], phoneOnly).concat(phoneOnly.contributions), rule, accounts, life).byBucket.get("wants")).toBe(
      4000000,
    );
  });

  test("money into funds is known in advance, so the budget doesn't project it at a pace", () => {
    const rule = {
      base: "fixed" as const,
      fixed_base: 10000000,
      buckets: [
        { id: "needs", name: "Needs", share_bp: 7000, holds_savings: false },
        { id: "wants", name: "Wants", share_bp: 3000, holds_savings: false },
      ],
      assignments: new Map([["gadgets", "wants"]]),
    };
    const oneFund = fundStates([phone], [], [], 1, noon("2026-10-03"));
    const { buckets } = budgetAdherence([], rule, byId([]), budgetMonthOf("2026-10-03"), "2026-10-03", 0, undefined, fundBudget(oneFund));
    const wants = buckets.find((b) => b.bucket.id === "wants")!;
    expect(wants.actual).toBe(1500000);
    expect(wants.projected).toBe(1500000);
    expect(wants.status).toBe("on_track");
  });
});

test("savedBefore is what the fund had put in just before a moment, spends aside", () => {
  const s = fundState(phone, [move("phone", 500000, "2026-11-05")], [spend("phone", 100000, "2026-11-07")], 1, noon("2026-11-15"));
  expect(savedBefore(s, istStartOf("2026-11-01"))).toBe(1500000);
  expect(savedBefore(s, noon("2026-11-10"))).toBe(1500000 + 1500000 + 500000);
});

test("finishedMonths keeps the scheduled months before this one", () => {
  const s = fundState(phone, [], [], 1, noon("2026-12-15"));
  expect(finishedMonths(s, budgetMonthOf("2026-12-15"))).toEqual([
    { amount: 1500000, occurred_at: istStartOf("2026-10-01").toISOString() },
    { amount: 1500000, occurred_at: istStartOf("2026-11-01").toISOString() },
  ]);
  // Kept as moves, with the schedule moved on to December, nothing changes.
  const kept = finishedMonths(s, budgetMonthOf("2026-12-15")).map((m) => ({ ...m, fund_id: "phone", is_monthly: true }));
  const moved = fundState({ ...phone, schedule_from: "2026-12-01" }, kept, [], 1, noon("2026-12-15"));
  expect(moved.balance).toBe(s.balance);
  expect(moved.thisMonth).toBe(s.thisMonth);
});
