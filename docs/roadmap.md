# Roadmap

Where Phase 1 of the [BRD](./personal-finance-dashboard-BRD.md) stands, and what comes next.
Update this file at the end of each step. Decisions go in [`tech-decisions.md`](./tech-decisions.md).

Last updated: 2026-09-29.

## Phase 1: replace the old app

| # | Step | Status | Where |
|---|---|---|---|
| 1 | Settle the decisions the schema depends on (money, dates, sign-in, tests) | Done | TD-8 to TD-11 |
| 2 | Sign-in: email and password, sign-ups closed (FR-13) | Done | PR #2, TD-10 |
| 3 | Core database schema, owner-only RLS, default categories | Done | PRs #3 and #5, TD-13 |
| 4 | Calculation library: money, IST dates, balances, totals, budgets | Done | PR #4, `src/lib/finance/` |
| 5 | **App shell, Accounts screen and fast entry (FR-1, FR-2, FR-3)** | **In progress:** 5a in review, 5b (fast entry) next | TD-14, TD-15 |
| 6 | Transaction list, category management, tags (FR-4, FR-5, FR-8.3) | To do | |
| 7 | History import (FR-14) | Done, as a script | PRs #6 and #7, TD-12 |
| 8 | Recurring commitments and budget rules (FR-6, FR-7) | To do | |
| 9 | Home and the Phase 1 insights: INS-01 to 06, 09, 10, 13, 17, 19 (FR-8, FR-9) | To do | |

The owner's history is already in the production database, so every screen from
step 5 on works against real data from day one.

## Step 5 in detail

- **App shell.** Phone-first navigation with Add always one tap away (FR-2). Bottom
  navigation on phones, side navigation on laptops. Every screen must work on both
  (NFR-1): check 320px and 390px phone widths and a laptop width, in light and dark mode.
- **Accounts screen (FR-1).** Balances by account and the summary from
  `balanceSummary()`: available money, card dues, savings, deposits, loans owed and net
  position. Archived accounts are hidden from entry but stay in reports. Account types
  are listed in TD-13.
- **Fast entry (FR-2, FR-3).** Amount first on a numeric keypad; date, time and account
  default sensibly; quick picks from frequent combinations; several lines in one go;
  duplicate an entry; edit and delete. A common expense must save in 3 taps or fewer
  after typing the amount (FR-2 AC1). A transfer to a credit card or loan reads as
  "Pay bill" or "Repay loan" (TD-13).
- **Data access.** Every page and Server Function calls `requireUser()` (TD-10), and
  figures come from `src/lib/finance/` so every screen agrees (NFR-5).
- **Installable, online only** (TD-14). Balances are summed in the database (TD-15).
- **Two PRs.** 5a: app shell, Accounts screen and installability. 5b: fast entry.

## Later

- **Phase 2:** remaining insights, optional AI (FR-10), export and backup (FR-11),
  budget month start day in settings (FR-12).
- **Phase 3:** AI-5 to AI-7, INS-14, INS-16, polish.
- **Before the owner stops using the old app:** re-run the history import on a fresh
  export. It skips rows already imported (TD-12).
