# Tech Decisions

Technology decisions for Paisa, the personal finance insights dashboard.
Requirements live in [`personal-finance-dashboard-BRD.md`](./personal-finance-dashboard-BRD.md).
The BRD leaves all technology choices to the builder; this file records them.

Add a new entry when a decision is made, with the date and the reason.

### TD-1 Stack
- **Date:** 2026-09-28
- **Decision:**
  - **Framework:** Next.js 16 with the App Router, React 19 and TypeScript, using the `src/` directory and the `@/*` import alias.
  - **Backend:** Server Components, Server Functions and Route Handlers. There is no separate API server.
  - **Package manager:** Bun installs packages and runs scripts (`bun.lock`). Next itself runs on its default Node runtime.
  - **Styling:** Tailwind CSS v4, with theme tokens in `src/app/globals.css`.
- **Why:** One codebase and one deployment for UI and backend. Bun makes installs and startup fast, and Tailwind suits phone-first layouts (NFR-1) and light and dark mode (NFR-7).
- **Note:** Next 16 differs from older versions. For example, Middleware is now `proxy.ts`, and `cookies()` is async. Check `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

### TD-2 Database and auth: Supabase
- **Date:** 2026-09-28
- **Decision:** Supabase (Postgres and Auth), accessed through `@supabase/ssr` with the **publishable key**. The project ref is `oyhkvltibmmuczwalkgm`.
  - `src/lib/supabase/client.ts` creates the browser client.
  - `src/lib/supabase/server.ts` creates the server client. Create a new one per request.
  - `src/proxy.ts` refreshes the auth session on every request.
- **Access rules:**
  - In the project settings, the Data API is on, "Automatically expose new tables" is **off**, and "Automatic RLS" is **on**.
  - Every migration that creates a table must also grant access to `authenticated` (never `anon`) and add RLS policies that limit each row to its owner (`auth.uid()`).
- **Why:** A hosted Postgres that phone and laptop share (FR-13), with built-in sign-in. No table is reachable through the API unless it is opened on purpose (NFR-6).

### TD-3 Schema changes: migrations deployed from Git
- **Date:** 2026-09-28
- **Decision:** All schema changes are SQL migrations in `supabase/migrations/`, made with the Supabase CLI (`bun supabase <command>`, installed as a dev dependency). The Supabase ↔ GitHub integration applies them to the database when they merge into `main`. It uses working directory `.` and "Deploy to production" is turned on.
- **Rules:**
  - Nobody changes tables by hand in the dashboard or runs `db push`.
  - Merging to `main` changes the live database, so merge a migration only when it's ready.
  - Vercel and Supabase deploy from the same merge in no guaranteed order. A migration must not break the app version currently deployed: add first, remove later.
  - Preview deployments use the production database, where a PR's own migration hasn't run yet. So a preview can't show code that needs that migration, and after the merge the new app may briefly run before the migration does. Ship a migration in its own PR, merged before the code that uses it, or make the code cope without it.
- **Why:** Schema history lives in Git, and every change is reviewed in a PR.

### TD-4 Hosting and configuration: Vercel
- **Date:** 2026-09-28
- **Decision:** Vercel builds every push. `main` goes to production, and branches and PRs get preview deployments. The Supabase ↔ Vercel integration syncs Supabase env vars to Vercel Production.
- **Config:**
  - `.env` is committed and holds only values that are public by design: the Supabase URL and publishable key. They ship to the browser anyway, and RLS enforces access. This lets a fresh clone run with `bun install && bun dev` and no setup, and preview deployments get the same values.
  - Secrets never go in `.env`. They go in `.env.local` (git-ignored) or in the platform's env settings.
- **Why:** Vercel is the native host for Next.js, and the integrations keep GitHub, Vercel and Supabase in sync.

### TD-5 Git workflow: `main` is PR-only
- **Date:** 2026-09-28
- **Decision:** Nobody pushes directly to `main`, including the owner and Claude sessions. All work happens on a branch, and `main` changes only when a PR is merged with green checks (CI `check`, Vercel, Supabase Preview).
- **Enforcement:**
  - A GitHub ruleset on `main` requires a pull request and the `check` status to pass. It blocks force pushes and branch deletion, and has no bypass.
  - `.githooks/pre-push` rejects pushes to `main` from any clone. `bun install` enables it through the `prepare` script.
  - `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every PR and on `main`.
- **Why:** Every merge to `main` deploys to production and can change the live database (TD-3, TD-4).

### TD-6 Public repo: no personal data
- **Date:** 2026-09-28
- **Decision:** `dubeyanant/paisa` is public, and no real personal or financial data ever goes into it:
  - no transactions, balances, salary, account or card names, trips or family details
  - no exports from the old app (`*.xlsx`, `*.xls` and `*.csv` are git-ignored)
  - examples, seed data and test fixtures are made up
  - commits use the owner's GitHub `noreply` email
- **Why:** The product holds private financial data (NFR-6). Anything committed to a public repo stays public, even after it is removed.

### TD-7 Claude Code cloud sessions
- **Date:** 2026-09-28
- **Decision:**
  - `.claude/settings.json` runs `scripts/cloud-setup.sh` at session start. In cloud sessions only (`CLAUDE_CODE_REMOTE`), the script installs Bun through npm if it's missing, then runs `bun install`.
  - Cloud sessions have **no Supabase access**. Supabase is not on the environment's network allowlist, and no credentials are set.
  - Cloud sessions write code and migrations, push a branch and open a PR. Running app behaviour is checked on the PR's Vercel preview.
- **Why:** Schema changes reach the database only through Git (TD-3), and cloud sessions never touch the production database.

### TD-8 Money: whole paise in `bigint`
- **Date:** 2026-09-28
- **Decision:** Every amount is stored as a whole number of paise in a `bigint` column (₹120.50 is `12050`). Code works in integer paise too, and converts to rupees only for display, as ₹ with Indian grouping (₹1,23,456.78). Never floats or `numeric` rupees.
- **Why:** Figures must be exact to the paisa and match on every screen (S4, BR-11, NFR-5). Integer sums have no rounding errors.

### TD-9 Dates and times: stored in UTC, shown in IST
- **Date:** 2026-09-28
- **Decision:** Moments are stored as `timestamptz` (UTC) and shown in IST (`Asia/Kolkata`). Anything that depends on the calendar, such as "today", budget months (FR-12) and weekdays, is worked out in IST, not in the server's time zone.
- **Why:** The owner lives in IST (A1), while Vercel and Postgres run in UTC. An expense at 00:30 IST must count on the right day and in the right month.

### TD-10 Sign-in: email and password, sign-ups closed
- **Date:** 2026-09-28
- **Decision:**
  - Supabase Auth with email and password. There is no magic link, because on a phone it opens in the browser, not the app installed on the home screen.
  - Sign-ups are **off** in Supabase Auth. The owner's account is created in the dashboard (Authentication → Users → Add user). The app has a sign-in page and no sign-up page.
  - `src/proxy.ts` sends signed-out visitors to `/login`. Every page, Server Function and Route Handler that touches data also calls `requireUser()` from `src/lib/auth.ts`, and RLS protects the rows themselves.
  - Signing out ends only the current device's session, so the owner stays signed in elsewhere (FR-13).
- **Why:** There is one user (FR-13), and the app is on a public URL, so nobody else must be able to create an account.

### TD-11 Tests: `bun test`
- **Date:** 2026-09-28
- **Decision:** All tests use Bun's built-in runner (`bun run test`), with `*.test.ts` files next to the code they test. CI runs them on every PR.
- **Why:** It's already installed, fast, and runs TypeScript directly. The priority is the calculation logic, which the BRD's acceptance criteria give exact figures for (NFR-5).

### TD-12 History import: a script, not a feature
- **Date:** 2026-09-28
- **Decision:** The owner's old-app history is imported once by a script run on the owner's computer, not through screens in the app (BRD v1.2, FR-14).
  - The script signs in as the owner, so RLS applies as for any other write. It needs no secret keys.
  - The export file and the account and category mappings stay outside Git (TD-6). The owner reviews the mappings once before the import.
  - Every run is one row in `import_batches`. Deleting that row deletes its transactions, which undoes the run.
  - Each imported row gets an `import_key`, unique per user. A re-run on a newer export skips rows already imported, so the final import can happen right before the owner stops using the old app.
  - Each row keeps the old app's names in `import_source`, so it can be traced back.
  - The export has no starting balances. The balance step (`balances.ts`) puts the difference from each account's real balance into its **opening balance**, not an adjustment dated on the import day (BRD FR-14.2 step 6), so past balances come out right too. The old app counts future-dated entries in its balances, so the comparison includes planned entries.
- **Why:** The import happens once. Building upload and mapping screens for it would cost more than any other Phase 1 feature, for no lasting use.

### TD-13 Data model
- **Date:** 2026-09-28
- **Decision:** The first migration (`supabase/migrations/*_core_schema.sql`) sets these rules:
  - **Transaction kinds:** `expense`, `income`, `refund` (money back that reduces a subcategory's spending, BR-6), `transfer`, and `adjustment` (a signed balance correction that no insight counts, BR-13).
  - **Account types:** the BRD's four (bank, credit card, wallet, savings) plus **loan** (money owed) and **deposit** (money held elsewhere that comes back, such as a rent deposit). Money moved into a deposit or a loan is neither spending nor saving. Both count toward net position.
  - **Balances are signed:** a credit card's or loan's balance is negative while money is owed, and its outstanding amount is the balance flipped. Paying a card bill or a loan is a transfer; the entry screen labels it "Pay bill" or "Repay loan".
  - **Categories:** always two levels. Income categories have subcategories too (for example Returns → Cashback), so every expense, income and refund has one. A subcategory can be deleted only while no transaction uses it; otherwise it is merged or hidden. **Lost Track** sits under Personal and is marked as system: it can be renamed but not deleted.
  - **Buckets belong to a budget rule.** Each rule has 2–6 buckets and its own subcategory → bucket assignments. One rule is active, and it applies to every month, so changing it recalculates history (FR-4 AC3, UAT-7). One bucket per rule holds savings transfers.
  - **Recurring commitments are templates.** Their pending entries are worked out from the schedule, not stored. Confirming one creates a transaction linked through `recurring_id`.
  - **Defaults:** a trigger on `auth.users` creates each user's settings, the 50/30/20 rule and the BRD §10 categories.
  - **Integrity:** references between tables include `user_id`, so rows can't point at another user's rows. Accounts, categories and subcategories that have transactions can't be deleted.
  - **Tests:** `supabase/tests/migrations.test.ts` runs every migration on an in-memory Postgres (PGlite) with a stand-in for Supabase's auth, then checks defaults, RLS and constraints. It runs in CI, because preview databases are off and a migration would otherwise run for the first time in production.
- **Why:** These rules keep every figure exact and consistent (NFR-5), keep the data private (NFR-6), and make the flexibility in FR-4 and FR-7 possible without losing history.

### TD-14 Installable, online only
- **Date:** 2026-09-29
- **Decision:**
  - Paisa can be added to the home screen and opens like an app: a web app manifest (`src/app/manifest.ts`), icons and Apple home-screen tags. There is no service worker.
  - It needs a connection. There's no offline mode and no queue of unsent entries. If a save fails, the form says so and keeps what was typed, so it can be sent again (the minimum NFR-4 allows).
  - `src/proxy.ts` lets `/manifest.webmanifest` through signed out, because browsers fetch it without cookies.
- **Why:** The owner is happy with an app that works online only. Caching signed-in pages for offline use is a lot of work for little gain. If entries ever get lost in practice, Next's experimental `useOffline` can keep a failed save pending and retry it when the connection returns.

### TD-15 Whole-history sums run in the database
- **Date:** 2026-09-29
- **Decision:**
  - A figure that needs every transaction, starting with account balances, comes from a SQL view (`account_balances`), not from loading every transaction into the app.
  - Each view follows the same rules as `src/lib/finance/`, and `supabase/tests/migrations.test.ts` checks that both give the same figures.
  - Views use `security_invoker`, so RLS still limits them to the owner's rows. They're granted to `authenticated` only.
  - The same goes for searching entries (FR-8.3). `search_transactions()` applies the filters and `transaction_totals()` sums what they match, so the totals cover every match, not just the rows on screen. Both are SQL functions with the caller's rights, granted to `authenticated` only.
  - Merging subcategories and categories (FR-4) is a SQL function too (`merge_subcategory()`, `merge_category()`), so a merge happens completely or not at all.
- **Why:** The owner already has thousands of entries, and the API returns at most 1,000 rows per request. Loading them all on every screen would be slow (NFR-3, NFR-8).

### TD-16 Recurring commitments and insights: pure functions
- **Date:** 2026-09-29
- **Decision:** Recurring commitments and the native insights are pure functions in `src/lib/finance/`, tested with `bun test`. Screens load rows and pass them in. A figure that needs the whole history, such as a balance, comes from the database instead (TD-15).
  - **Due dates** come from each commitment's schedule (`recurring.ts`). A monthly due day missing from a month (the 31st) falls on its last day.
  - **Payments cover due dates in order:** the first linked payment (`recurring_id`) covers the first due date, and so on. Paying early or late still counts. A due date on or before today with no payment is a pending entry. A planned entry linked to a commitment covers its due date.
  - **Reserved money** is every unpaid due date and planned outgoing entry up to the end of the budget month, overdue ones included.
  - **Detection** (`detection.ts`) groups unlinked expenses by subcategory and note (transfers by their two accounts and note), and needs a regular gap (weekly, monthly, every 3 or 6 months, yearly), amounts within half of each other, and a recent payment. It offers a series after 3 payments; INS-09 lists one after 2.
  - **"Min data"** in BRD §9 counts budget months including the current one. Until there's enough, an insight returns `{ ready: false, monthsToGo }`.
  - **INS-19** ranks the flags from INS-04, 05, 09, 10 and 17 by rupee impact.
  - **Owner decisions:** "this year" means the calendar year (INS-11, INS-15). Next month's planned entries show in Upcoming but aren't reserved this month. A pending due date gets a "Skip" option with the recurring screens (step 8); it needs a small migration.
- **Why:** The BRD gives exact figures for these (UAT-3, 8, 9, 10), so they're tested without a database or a screen (NFR-5), and every screen uses the same numbers.

### TD-17 Charts: Recharts
- **Date:** 2026-09-29
- **Decision:** Charts on the Insights, Budget and Home screens use [Recharts](https://recharts.org). It's installed with the first chart (roadmap step 9).
  - Charts are Client Components. The headline and figures around a chart render on the server, so a screen reads fine before its charts load (FR-8 AC2).
  - Colours come from the theme tokens in `globals.css` (`var(--accent)` and so on), so charts follow light and dark mode (NFR-7).
  - Small shapes such as a progress bar or a budget meter stay plain HTML and CSS; they don't need a library.
- **Why:** Recharts draws SVG, so it takes colours from CSS variables and resizes to fit a phone or a laptop (NFR-1). It covers every chart the insights need (bars, stacked bars, lines, areas, donuts) with little code, and supports React 19. Chart.js draws on a canvas, which can't read CSS variables; ECharts is much larger; visx and D3 need far more code for each chart.

## Open decisions

Decide these when the related work starts. Until then they are only suggestions.

| Topic | Relevant BRD | Suggested starting point |
|---|---|---|
| Parsing .xlsx for import | FR-14 | SheetJS (`xlsx`) in the import script only |
| Storing AI provider keys | FR-10.1, NFR-6 | Encrypted on the server, never sent back to the client |
