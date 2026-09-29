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
- **Decision:** Supabase (Postgres and Auth), accessed through `@supabase/ssr` with the **publishable key**. The project is `paisa` in Mumbai, ref `ofpqojapszjpgeshvjfu` (TD-19).
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
  - Preview deployments, pre-prod included (TD-5), use the production database, where a migration runs only once it merges into `main`. So pre-prod can't show code that needs a new migration, and after the merge the new app may briefly run before the migration does. Push a migration to `dev` and get it merged into `main` before pushing the code that uses it, or make the code cope without it.
- **Why:** Schema history lives in Git, and every change is reviewed in a PR.

### TD-4 Hosting and configuration: Vercel
- **Date:** 2026-09-28
- **Decision:** Vercel builds every push. `main` goes to production, and branches and PRs get preview deployments. The Supabase ↔ Vercel integration syncs Supabase env vars to Vercel Production.
- **Config:**
  - `.env` is committed and holds only values that are public by design: the Supabase URL and publishable key. They ship to the browser anyway, and RLS enforces access. This lets a fresh clone run with `bun install && bun dev` and no setup, and preview deployments get the same values.
  - Secrets never go in `.env`. They go in `.env.local` (git-ignored) or in the platform's env settings.
- **Why:** Vercel is the native host for Next.js, and the integrations keep GitHub, Vercel and Supabase in sync.

### TD-5 Git workflow: work on `dev`, `main` only by PR from `dev`
- **Date:** 2026-09-28 (revised 2026-09-29: the `dev` branch and pre-prod)
- **Decision:**
  - Work is committed and pushed straight to `dev`, by the owner and by Claude sessions.
  - Every push to `dev` deploys to **pre-prod**: Vercel's preview deployment for the branch, at its fixed branch URL `paisa-git-dev-anant-dubeys-projects.vercel.app`. Pre-prod uses the production database (TD-3, TD-4), so what's done there changes real data.
  - `main` changes only when the owner merges a PR from `dev` in GitHub, with green checks (CI `check` and `from-dev`, Vercel, Supabase Preview). Claude sessions may open that PR but never merge it.
  - PRs into `main` are merged with a merge commit, so `dev` stays an ancestor of `main` and the next PR shows only what's new.
- **Enforcement:**
  - A GitHub ruleset on `main` requires a pull request merged with a merge commit, and the `check` and `from-dev` statuses to pass. It blocks force pushes and branch deletion, and has no bypass.
  - `.github/workflows/pr-source.yml` (`from-dev`) fails any PR into `main` that doesn't come from this repo's `dev`.
  - A ruleset on `dev` blocks force pushes and branch deletion.
  - `.githooks/pre-push` rejects pushes to `main` from any clone. `bun install` enables it through the `prepare` script.
  - `.claude/settings.json` denies `gh pr merge`.
  - `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every PR and on pushes to `main` and `dev`.
- **Why:** Every merge to `main` deploys to production and can change the live database (TD-3, TD-4). One working branch with a fixed pre-prod URL lets the owner try each change, on a phone too, and choose when it goes live.

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
  - Cloud sessions write code and migrations and push them to `dev` (TD-5). Running app behaviour is checked on pre-prod.
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
  - **New subcategories:** a new expense subcategory is given a bucket in the active rule when it's created. Other rules count it as unassigned until it's given one there.
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
  - So is saving a budget rule (FR-7, `save_budget_rule()`): its base and all its buckets at once, so the shares never stop adding up to 100%. A removed bucket hands its subcategories and overrides to the bucket the owner picks. The app edits the one active rule in place; a preset such as 60/20/20 just fills in its buckets.
- **Why:** The owner already has thousands of entries, and the API returns at most 1,000 rows per request. Loading them all on every screen would be slow (NFR-3, NFR-8).

### TD-16 Recurring commitments and insights: pure functions
- **Date:** 2026-09-29
- **Decision:** Recurring commitments and the native insights are pure functions in `src/lib/finance/`, tested with `bun test`. Screens load rows and pass them in. A figure that needs the whole history, such as a balance, comes from the database instead (TD-15).
  - **Due dates** come from each commitment's schedule (`recurring.ts`). A monthly due day missing from a month (the 31st) falls on its last day.
  - **Payments cover due dates in order:** the first linked payment (`recurring_id`) covers the first due date, and so on. Paying early or late still counts. A due date on or before today with no payment is a pending entry. A planned entry linked to a commitment covers its due date.
  - **Reserved money** is every unpaid due date and planned outgoing entry up to the end of the budget month, overdue ones included.
  - **Detection** (`detection.ts`) groups unlinked expenses by subcategory and note (transfers by their two accounts and note), and needs a regular gap (weekly, monthly, every 3 or 6 months, yearly), amounts within half of each other, and a recent payment. It offers a series after 3 payments; INS-09 lists one after 2.
  - **Skipping a due date** (a month the gym was closed, a bill that didn't come) stores it in `recurring_skips`. It drops out of the schedule, so it's neither pending nor reserved, and payments cover the remaining due dates in order. Deleting the row undoes the skip.
  - **Confirming a due date** records the payment linked to the commitment, dated now if it's due today, or at noon IST on the due date if it's overdue, so a late confirmation still lands in the month it was due. Only the oldest unpaid due date of each commitment can be confirmed or skipped, since a payment always covers the oldest one.
  - **Detection on the Recurring screen** looks at the last 400 days, enough for three payments every 6 months.
  - **"Min data"** in BRD §9 counts budget months including the current one. Until there's enough, an insight returns `{ ready: false, monthsToGo }`.
  - **INS-19** ranks the flags from INS-04, 05, 09, 10 and 17 by rupee impact.
  - **INS-09 leaves out card bill payments** (2026-09-29). Paying a credit card isn't a cost of its own: what was bought on the card already counts as spending.
  - **Tuned after the owner's first look at real data** (2026-09-29):
    - **Savings rate (INS-02) covers finished months only.** Until a month ends, rent and bills still to pay look like money saved (90% on day 9). Home shows last month's.
    - **Pace (INS-04) counts everyday spending only** (`everyday()`): payments linked to a planned payment, and anything in the subcategory of an active one, are left out, since they're known in advance. The subcategory rule covers imported history, which isn't linked.
    - **A budget bucket's status looks at where the month is heading:** planned payments in full, paid or not (`stillToPay()`), plus everyday spending at its pace so far. Rent paid on the 1st no longer makes Needs "at risk".
    - **Alerts (INS-19) have minimums:** ₹1,000 ahead of pace, above usual or over a target, and ₹500 a year for a price rise. Price alerts are for payments the owner set up only; detected series such as groceries change price all the time. The insights still show the smaller figures.
    - **Committed vs free (INS-01) isn't shown**: available to spend already answers the question. It was a sentence on Insights until the owner trimmed the screen (2026-09-30, roadmap).
    - **Small spends (INS-06) cover the last 30 days**, so the figure is a full month's worth on any day.
  - **Every figure can be explained and opened** (owner, 2026-09-29): each insight shows what it compares against (a usual month's ₹, where a bucket is heading and why), and each row opens the matching entries on the Entries screen. Savings are charted in rupees, with each month's income and spending listed; a rate below -100% isn't shown. Screens go red on the same ₹1,000 rule as alerts (`hotEnough()`), and money owed (card dues, loans) is red.
  - **Owner decisions:** "this year" means the calendar year (INS-11, INS-15). Next month's planned entries show in Upcoming but aren't reserved this month. A pending due date can be skipped (step 8). On screen, commitments and one-off planned entries are both "planned payments" (TD-18).
- **Why:** The BRD gives exact figures for these (UAT-3, 8, 9, 10), so they're tested without a database or a screen (NFR-5), and every screen uses the same numbers.

### TD-17 Charts: Recharts
- **Date:** 2026-09-29
- **Decision:** Charts on the Insights, Budget and Home screens use [Recharts](https://recharts.org). It's installed with the first chart (roadmap step 9).
  - Charts are Client Components. The headline and figures around a chart render on the server, so a screen reads fine before its charts load (FR-8 AC2).
  - Colours come from the theme tokens in `globals.css` (`var(--accent)` and so on), so charts follow light and dark mode (NFR-7).
  - Small shapes such as a progress bar or a budget meter stay plain HTML and CSS; they don't need a library.
  - **Kinds of money have colours** (owner, 2026-09-29): available to spend in light green (`--spendable`), planned money in light orange (`--planned`), savings in green (`--saving`), money owed and negative amounts in red. A budget bar shows what's gone in solid colour, then planned payments still to come in a lighter shade of the same colour (`BudgetBar`).
  - **Phone and laptop (owner, 2026-09-29):** what's used day to day works fully on a phone (adding, entries, balances, free money, budget status, alerts), and every insight keeps its headline and figure there. A chart or table too wide or dense for a phone, such as a multi-series trend or a month-by-category table, can be laptop-only. The phone then shows a compact stand-in, such as the top few items, with a note that the full view is on a larger screen.
- **Why:** Recharts draws SVG, so it takes colours from CSS variables and resizes to fit a phone or a laptop (NFR-1). It covers every chart the insights need (bars, stacked bars, lines, areas, donuts) with little code, and supports React 19. Chart.js draws on a canvas, which can't read CSS variables; ECharts is much larger; visx and D3 need far more code for each chart.

### TD-18 Planned money and "available to spend"
- **Date:** 2026-09-29 (revised the same day: the first version used "blocked" accounts)
- **Decision:**
  - **Planned payments are one idea.** A payment either repeats (a recurring commitment, TD-16) or happens once (a planned entry, BR-7). More → Planned lists both, and one form creates either. The money stays in the account it's paid from until the owner confirms the payment.
  - **Available to spend** = bank and cash − set-aside money − card dues − **planned payments still to pay this budget month**, overdue ones included (`plannedToPay()`). Home and Accounts lead with it, and every screen gets it from `getMoneySummary()`.
  - `plannedToPay()` leaves out what doesn't come out of money available to spend:
    - payments from a set-aside, savings, deposit or loan account
    - transfers into a credit card (card dues already count) or into an ordinary bank or wallet account
    - A planned expense on a card still counts, since it becomes card dues.
  - A bank or wallet account can be **set aside** as a sinking fund (stored as `accounts.is_blocked`). Its balance isn't available to spend, but still counts in net position.
  - The budget month's start day is set in More → Settings (FR-12, brought forward from Phase 2), since "this month" decides what's subtracted.
  - The Accounts summary hides a figure that is ₹0, such as Loans with nothing owed.
- **Why:** The owner used to "block" money in the old app by moving it to a Blocked account, but the money never left the bank. Planned payments say the same thing directly, without a make-believe account, and one idea replaces two.

### TD-19 Everything in Mumbai
- **Date:** 2026-09-29
- **Decision:**
  - The database is the Supabase project `paisa` in `ap-south-1` (Mumbai), and `vercel.json` runs Vercel's functions in `bom1` (Mumbai).
  - It replaced the first project, now named `paisa-seoul` (`ap-northeast-2`). The old project is kept for a week as a fallback, then deleted.
  - **The move:** the new project's schema and migration history came from a one-time `supabase db push` into the empty database. It's the only exception to TD-3's rule, and it does what the GitHub integration would. The data, the owner's sign-in included (same user ID and password), was copied with `pg_dump --data-only` and restored with triggers paused, so no default data was created twice. Before the app switched, a read-only check matched both sides by row count and a checksum of every row, for every table and for the balances, along with the migrations, RLS policies, grants and functions. The app changed only its URL and publishable key.
- **Why:** Pages were slow to load. Vercel ran the functions in Washington DC (its default) and the database was in Seoul, so each of a page's rounds of queries took about 190 ms before the page reached the owner in Mumbai. With the owner, the functions and the database in one city, each round takes a few milliseconds.

### TD-20 Screens load in one round, appear in parts, and stay for 30 seconds
- **Date:** 2026-09-29
- **Decision:**
  - **One round of queries per screen.** A screen starts every load at once. Home, Insights and Budget used to wait for the budget month start day before loading their history. Now they load enough days to cover any start day (`daysBackFor()`, a month being at most 31 days) and keep the months they need (`inMonths()`).
  - **Long ranges load in slices at once.** `getRecentTransactions(days)` splits the range into 60-day slices loaded side by side, instead of 1,000-row pages one after another. Insights and Planned use one 400-day load for both the history and recurring-payment detection.
  - **Loads shared within a request run once:** accounts, labels, planned payments, settings, the budget rule and tags are wrapped in React's `cache()`.
  - **Screens with slow parts stream them:** each part is its own `<Suspense>` with a placeholder the size of the part, and the header shows at once.
    - Home: available to spend, Due now and the latest entries first, then the budget and insights.
    - Insights: each card.
    - Budget: the whole body.
    - Planned: the suggestions found in your entries after the rest.
    - Entries: the filters, then the results. When the filters change, the old results stay until the new ones are in.
    - A tag's screen: its suggested entries after the rest.
  - The other screens load in one round in about 100 ms, and `loading.tsx` covers the wait, so they don't stream: a header-first step there would only add a second flash.
  - **Client cache:** `experimental.staleTimes.dynamic` is 30 seconds, so going back to a screen seen in the last 30 seconds is instant. Every save calls `revalidatePath("/", "layout")`, which clears this cache, so a screen never shows figures from before a save. A change made on another device can take up to 30 seconds to show.
- **Why:** The owner found screens blank for too long before anything showed. TD-19 covers the network side.

### TD-21 Funds: saving up inside the bank
- **Date:** 2026-09-30
- **Decision:** A **fund** keeps money for a purpose without moving it. It's listed in More → Planned, next to planned payments (TD-18).
  - **Two kinds:**
    - A **goal** saves a target over the budget months you pick (₹60,000 over October to January is ₹15,000 a month), then pays for one purchase.
    - An **ongoing fund** (Clothes, Trips) saves an optional monthly amount, up to an optional cap, and pays for any number of spends.
  - **Money in:**
    - Each budget month's amount goes in on the month's first day.
    - Money can also be added or taken out by hand at any time (`fund_moves`).
    - A goal's share of a month is what's still to save divided by the months left, rounded up to the rupee, so an extra amount added by hand lowers the months after it.
  - **The balance** is what went in minus what was spent from it. The money stays in the bank, but the balance is held back from **available to spend**: bank and cash − set aside − card dues − planned payments − fund balances.
  - **Spending from a fund:**
    - An expense (or a refund) that has happened can be marked "From fund" (`transactions.fund_id`).
    - The fund covers as much as it holds. Anything above that counts like any other spend in its month.
    - Paying from a fund leaves available to spend unchanged: the bank goes down by the amount the fund releases.
    - A planned entry can't use a fund until it's confirmed.
  - **Closing:**
    - A goal closes at its purchase, its first expense. A goal bought for less frees what's left; one bought early counts the part not yet saved in that month.
    - A fund can also be closed by hand, which frees its balance.
    - A fund with spends can't be deleted, only closed, so history stays.
  - **Budget (FR-7):**
    - Money counts in the fund's bucket when it goes in, as a payment known in advance, not spending at a pace.
    - The part of a spend a fund covers isn't counted again, in the budget or in spending pace (INS-04).
    - Money freed when a fund closes, or taken out by hand, is subtracted in its month. So over a fund's life the bucket counts exactly what was spent from it.
    - The other insights (savings, categories vs usual, small spends, the Entries totals) see spends as they happened.
  - **Changing a schedule** (the target, the last month, the monthly amount or the cap) keeps the months already finished as they were. They're saved as `fund_moves`, and the new schedule runs from this month (`schedule_from`).
  - The logic is pure functions in `src/lib/finance/funds.ts` (TD-16).
- **Why:** The owner saves for big purchases over months, and used to keep Things, Clothes and Trip bucket accounts for spending that comes and goes. A one-off planned payment took the whole amount out of a single month, and bucket accounts meant moving make-believe money around, the problem TD-18 got rid of. A fund spreads the cost over the months it's saved in and keeps the money where it really is.

## Open decisions

Decide these when the related work starts. Until then they are only suggestions.

| Topic | Relevant BRD | Suggested starting point |
|---|---|---|
| Parsing .xlsx for import | FR-14 | SheetJS (`xlsx`) in the import script only |
| Storing AI provider keys | FR-10.1, NFR-6 | Encrypted on the server, never sent back to the client |
