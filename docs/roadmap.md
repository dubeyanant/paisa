# Roadmap

Where Phase 1 of the [BRD](./personal-finance-dashboard-BRD.md) stands, and what comes next.
Update this file at the end of each step. Decisions go in [`tech-decisions.md`](./tech-decisions.md).

Last updated: 2026-09-30 (trial week: faster page loads, fewer things on Home and Insights, and funds).

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
| 9 | Home and the Phase 1 insights: INS-01 to 06, 09, 10, 13, 17, 19 (FR-8, FR-9) | Done | PRs #23, #24 and the tag reports PR, TD-16, TD-17 |

The logic for steps 8 and 9 was built alongside step 5, since it touches no screens.
It also covers the Phase 2 insights INS-07, 08, 11, 12, 15 and 18, which cost little
once the rest existed; their screens stay in Phase 2.

The owner's history is already in the production database, so every screen from
step 5 on works against real data from day one.

## Speed, during the trial week

The owner found every page slow to appear. Fixes, in order:

1. **Everything in Mumbai (TD-19):** the database moved from Seoul to a new Supabase project in
   Mumbai, and Vercel's functions from Washington DC to Mumbai. Done.
2. Keep recently visited screens for 30 seconds (`staleTimes.dynamic`), so switching back to one is instant. Done (TD-20).
3. Stream Home in parts, so available to spend shows before the insights. Done (TD-20).
4. One round of queries per screen, history in slices loaded at once, and streaming on Insights, Budget,
   Planned, Entries and tag screens. Done (TD-20).
5. Cold starts: the first page after about 20 idle minutes takes about 2 s before anything shows. Next:
   check Fluid compute and keep the server warm with a ping.

## Trimming, during the trial week

The owner wants each screen to keep only what gets used: the 20% of features that give
80% of the benefit (2026-09-30).

- **Home:** available to spend, then the budget buckets with spending pace and last month's
  savings under them, in short phrases. Due now, Planned and Latest stay. Alerts (INS-19) are
  off Home for now; `topAlerts()` stays in the calculation library.
- **Insights:** saved each month, emergency fund, spending pace, categories vs usual, small
  spends and recurring payments. The four headlines at the bottom (income and planned
  payments, coming up, budget, trips and tags) are gone. Small spends stays while the owner
  decides whether it's used; the "above usual" and price-rise flags stay too.
- **Navigation:** on a laptop, Insights and Budget are in the side navigation, and More
  lists only the rest. On a phone the tab bar is unchanged, and More lists them all.
- **Layout and links:** on a laptop, Home's left column (available to spend and budget) stays
  put while the right one scrolls, and Insights stacks its cards in two columns without
  gaps. Each saved month on Insights opens that month's entries. Entry lists on Home and
  Entries show each day's net (income and refunds minus expenses, like the Entries
  totals); a day the list may have cut short shows none.

## Funds, during the trial week (TD-21)

The owner saves for big purchases over a few months, and used to keep Things, Clothes and
Trip bucket accounts (now archived). Funds replace both: the money stays in the bank, and
only what a fund holds is kept out of available to spend.

1. **Migration** (`funds`, `fund_moves`, `transactions.fund_id`, `update_fund()`). Pushed to
   `dev`; it has to merge into `main` before the screens (TD-3).
2. **Screens:** More → Planned lists funds, and New has Once, Repeats and Save up. A fund's
   screen adds or takes out money, changes the schedule, closes it and shows its history.
   Add and edit take "From fund". Home shows a Funds line under the budget and "In funds"
   under available to spend. Budget counts money into funds, and pace leaves out what funds
   paid for. Pushed once step 1 is in `main`.
3. **Owner's review:** the two kinds are a target fund (a guitar: a set amount over some
   months) and a recurring fund (clothes: a monthly amount up to a limit, filling back up
   after spends). Funds stay open after spends until closed by hand.

## Step 9 in detail

Step 9 ships in three PRs based on `main`. None needs a migration.

- **9a (#23): Home (FR-8).** Available to spend leads. Below it, this month at a glance: free
  money left with committed vs free (INS-01), spending against a usual month (INS-04),
  savings rate against last month (INS-02) and each budget bucket (INS-17). The top 3
  alerts (INS-19) come next, then Due now, the next 3 planned payments with the 30-day
  total (INS-10), and the latest entries. Overdue payments aren't among Home's alerts,
  since Due now lists them with a Confirm button. Headlines are in `src/lib/home.ts`.
- **9b (#24): Insights screen (FR-8.4).** Each insight has a headline with a number, or says how
  many more months it needs (FR-9 AC2): savings rate with a 6-month Recharts chart (INS-02),
  emergency fund cover (INS-03), pace by category (INS-04), categories against usual with
  their last 6 months (INS-05), the top 3 small spends (INS-06), and every recurring payment
  with its monthly and yearly cost and price changes (INS-09). Coming up (INS-10) and Budget
  (INS-17) show as headlines that link to their screens. Every part fits a phone, so none is
  laptop-only. Insights is in the side navigation; on a phone the tab bar has no room, so
  it's reached from Home's alerts and from More. Settings sets the small-spend limit
  (₹50 to ₹1,000, ₹200 by default). Headlines are in `src/lib/insights.ts`.
- **9c: tag reports (INS-13).** A tag's screen leads with what it cost, over how many days,
  per day and where most of it went ("Goa Trip: ₹18,000 over 6 days, ₹3,000/day; 40% on
  Fun & Travel"), and how its cost per day compares with the other tags. Where it went
  breaks it down by category and subcategory, and a chart ranks every tag by cost per
  day. The Tags list shows each tag's total and cost per day, and Insights links to the
  latest one. Only tagged entries are loaded, so this stays quick.
- **Owner feedback on real data:** the first look showed alerts for tiny amounts (₹36 a
  year on milk), a 90% savings rate on day 9, and four numbers for free money. Savings rate
  now covers finished months, pace and budget status allow for planned payments, alerts
  have minimums, and free money is one sentence on Insights (TD-16). A second look asked
  what the figures compared against: rows now open their entries, buckets say where the
  month is heading, and savings are charted in rupees.

Phase 1 is done once the owner has used Paisa for a week (the owner's call;
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


## Later

- **Phase 2:** remaining insights, optional AI (FR-10), export and backup (FR-11).
  The budget month start day (FR-12) already shipped with step 8.
- **Phase 3:** AI-5 to AI-7, INS-14, INS-16, polish.
