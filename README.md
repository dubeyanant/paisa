# Paisa

Personal finance insights dashboard. Requirements are in
[`docs/personal-finance-dashboard-BRD.md`](./docs/personal-finance-dashboard-BRD.md).
Tech decisions are logged in [`docs/tech-decisions.md`](./docs/tech-decisions.md).

## Stack

- **Next.js 16** (App Router, Turbopack), TypeScript, React 19
- **Bun** as package manager and script runner
- **Tailwind CSS v4**
- **Supabase** for Postgres and auth, schema via CLI migrations
- **Vercel** for hosting

## Getting started

```sh
bun install
bun dev
```

Open http://localhost:3000. No env setup is needed: `.env` holds the public
Supabase URL and publishable key. Secrets go in `.env.local`, which is git-ignored.

## Scripts

| Command | What it does |
|---|---|
| `bun dev` | Dev server with hot reload |
| `bun run build` | Production build |
| `bun start` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | TypeScript check |
| `bun run test` | Tests (`bun test`) |
| `bun supabase <cmd>` | Supabase CLI (e.g. `migration new`) |

## Workflow

- **`main` is PR-only.** Branch, open a PR, merge when checks are green. A GitHub
  ruleset and a pre-push hook (enabled by `bun install`) enforce this.
- **Vercel** deploys production from `main` and previews from branches and PRs.
- **Supabase** applies new files in `supabase/migrations/` to the database on
  merge into `main`.
- **CI** runs lint, typecheck, tests and build on every PR.
- **Claude Code cloud sessions** set themselves up via `scripts/cloud-setup.sh`
  and need no configuration. They have no Supabase access by design.
- **This repo is public.** Never commit real financial or personal data.

## Layout

```
.claude/settings.json  cloud session hook
.githooks/             pre-push hook blocking direct pushes to main
.github/workflows/     CI: lint, typecheck, test, build
docs/                  BRD and tech decisions
scripts/               cloud-setup.sh
src/
  app/                 routes (App Router)
  lib/supabase/        Supabase clients (browser, server) and session refresh
  proxy.ts             runs before every request (Next 16's name for middleware)
supabase/              CLI config and migrations
```
