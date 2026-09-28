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
- **Decision:** Supabase (Postgres and Auth), accessed through `@supabase/ssr` with the **publishable key**. The project ref is `zdqqqerbbzmiljibfgws`.
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
  - `.github/workflows/ci.yml` runs lint, typecheck and build on every PR and on `main`.
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

## Open decisions

Decide these when the related work starts. Until then they are only suggestions.

| Topic | Relevant BRD | Suggested starting point |
|---|---|---|
| How money is stored | S4, BR-11, NFR-5 (exact to the paisa) | Store amounts as integer paise (`bigint`), never floats |
| Sign-in method | FR-13 | Supabase email magic link or password, single user |
| Allowing new sign-ups | FR-13 (single user) | Turn off sign-ups in Supabase Auth once the owner's account exists |
| Date and time handling | A1 (IST), FR-14 (spreadsheet serial dates) | Store in UTC, show in IST |
| PWA / installability and offline entry | NFR-2, NFR-4 | — |
| Charts library | FR-8, Section 9 | — |
| Test framework | Section 13 (UAT), NFR-5 | `bun test` for calculation logic |
| Parsing .xlsx for import | FR-14 | — |
| Storing AI provider keys | FR-10.1, NFR-6 | Encrypted on the server, never sent back to the client |
