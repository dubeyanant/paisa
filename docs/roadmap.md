# Roadmap

Where Phase 1 of the [BRD](./personal-finance-dashboard-BRD.md) stands, and what comes next.
Update this file at the end of each step. Decisions go in [`tech-decisions.md`](./tech-decisions.md).

Last updated: 2026-09-29 (step 9: Home and Insights done, tag reports next).

## Phase 1: replace the old app

| # | Step | Status | Where |
|---|---|---|---|
| 1 | Settle the decisions the schema depends on (money, dates, sign-in, tests) | Done | TD-8 to TD-11 |
| 2 | Sign-in: email and password, sign-ups closed (FR-13) | Done | PR #2, TD-10 |
| 3 | Core database schema, owner-only RLS, default categories | Done | PRs #3 and #5, TD-13 |
| 4 | Calculation library: money, IST dates, balances, totals, budgets | Done | PR #4, `src/lib/finance/` |
| 5 | App shell, Accounts screen and fast entry (FR-1, FR-2, FR-3) | Done | PRs #10 and #11, TD-14, TD-15 |
| 6 | Transaction list, category management, tags (FR-4, FR-5, FR-8.3) | Done | PRs #12 to #15, TD-15 |
| 7 | History import (FR-14) | Done, as a script | PRs #6 and #7, TD-12 |
| 8 | Recurring commitments and budget rules (FR-6, FR-7) | Done | PRs #16 to #22, TD-16, TD-18 |
| 9 | Home and the Phase 1 insights: INS-01 to 06, 09, 10, 13, 17, 19 (FR-8, FR-9) | In progress: Home and Insights done, tag reports to do | `src/lib/finance/`, TD-16, TD-17 (charts) |

The logic for steps 8 and 9 was built alongside step 5, since it touches no screens.
It also covers the Phase 2 insights INS-07, 08, 11, 12, 15 and 18, which cost little
once the rest existed; their screens stay in Phase 2.

The owner's history is already in the production database, so every screen from
step 5 on works against real data from day one.

## Step 9 in detail

Step 9 ships in three PRs based on `main`. None needs a migration.

- **9a (#23): Home (FR-8).** Available to spend leads. Below it, this month at a glance: free
  money left with committed vs free (INS-01), spending against a usual month (INS-04),
  savings rate against last month (INS-02) and each budget bucket (INS-17). The top 3
  alerts (INS-19) come next, then Due now, the next 3 planned payments with the 30-day
  total (INS-10), and the latest entries. Overdue payments aren't among Home's alerts,
  since Due now lists them with a Confirm button. Headlines are in `src/lib/home.ts`.
- **9b: Insights screen (FR-8.4).** Each insight has a headline with a number, or says how
  many more months it needs (FR-9 AC2): savings rate with a 6-month Recharts chart (INS-02),
  emergency fund cover (INS-03), pace by category (INS-04), categories against usual with
  their last 6 months (INS-05), the top 3 small spends (INS-06), and every recurring payment
  with its monthly and yearly cost and price changes (INS-09). Coming up (INS-10) and Budget
  (INS-17) show as headlines that link to their screens. Every part fits a phone, so none is
  laptop-only. Insights is in the side navigation; on a phone the tab bar has no room, so
  it's reached from Home's alerts and from More. Settings sets the small-spend limit
  (₹50 to ₹1,000, ₹200 by default). Headlines are in `src/lib/insights.ts`.
- **9c: tag reports (INS-13).** On a tag's screen: total, days, cost per day, the
  breakdown by category and a comparison with other tags.

Phase 1 is done after 9c, once the owner has used Paisa for a week (the owner's call;
the BRD's exit criterion says 2 weeks). The owner already logs everything in Paisa, not
the old app, so no second import is needed.

## Step 8 in detail

Step 8 shipped in parts, each a PR based on `main`. Every migration merged before the
screens that use it (TD-3).

- **8a (#16): skipping a due date.** `recurring_skips` holds due dates the owner skipped, and
  the calculation library leaves them out of the schedule (TD-16).
- **8b (#17): recurring commitments (FR-6).** More → Recurring lists, adds, edits, pauses and
  deletes commitments, and shows money reserved this month. Due now (also on Home) confirms
  a due date with one tap, with the amount editable first, or skips it with an undo, and
  confirms planned entries whose date has come (BR-7). Coming up shows the next 30 days
  with a total. Payments detected in the history are offered as new commitments.
- **Owner feedback (#18, #19, then planned payments): what's free to spend.** A first
  version marked accounts as "blocked". The owner then chose one idea instead: planned
  payments, repeating or once, that stay in their account but aren't free to spend.
  More → Recurring became More → Planned, the switch became "Set aside (sinking fund)",
  and More → Settings sets the day the month starts (FR-12, brought forward) (TD-18).
- **8c (#20 and the budget screens PR): budget rules (FR-7).** `save_budget_rule()` saves a
  rule all at once (TD-15). More → Budget shows each bucket's target, actual, what's left,
  share of the base and pace, and the last 6 months (a full table on larger screens, a
  row of marks per bucket on a phone). Edit rule picks a preset or custom buckets (2 to 6,
  adding up to 100%) and the base. An entry's edit screen can move that one entry to
  another bucket.

## Step 6 in detail

Step 6 shipped in three parts. The migration went first, because a preview can't run code
whose migration hasn't run yet (TD-3). #13 and #14 were stacked PRs that merged into each
other's branches, so #15 brought them to `main`.

- **6a (#12): database functions.** Search and totals for the Entries screen, and
  all-or-nothing merges (TD-15).
- **6b (#13): Entries screen (FR-8.3).** Search and filters by dates, kind, account,
  category, bucket, tag and amount, with totals over every match. The tab bar gets Entries
  with Add in the middle. Balance corrections are made from an account's screen and
  deleted from their own entry.
- **6c (#14): categories and tags (FR-4, FR-5).** More → Categories adds, renames, hides,
  reorders, moves and merges categories and subcategories, and sets each one's bucket.
  More → Tags creates tags with optional dates, and suggests untagged entries from those
  dates. The Add and edit screens take tags, and suggest a dated tag for an entry in its
  range; nothing is tagged until the owner taps it.

The tag report (INS-13) comes with the insights in step 9. Until then, a tag's screen
and the Entries screen filtered by that tag show its total.

## Later

- **Phase 2:** remaining insights, optional AI (FR-10), export and backup (FR-11).
  The budget month start day (FR-12) already shipped with step 8.
- **Phase 3:** AI-5 to AI-7, INS-14, INS-16, polish.
