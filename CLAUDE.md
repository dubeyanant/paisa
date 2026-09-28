@AGENTS.md

- Requirements: `docs/personal-finance-dashboard-BRD.md`
- Tech decisions: @docs/tech-decisions.md (log new decisions there)

## Rules

- **Never commit or push directly to `main`** (TD-5). Work on a branch and open a PR
  with `gh pr create`. Every merge to `main` deploys to production and can change
  the live database. Never bypass the ruleset or the pre-push hook.
- **This repo is public** (TD-6). Never commit the owner's real financial data or
  personal details. Examples, seed data and test fixtures must be made up.
