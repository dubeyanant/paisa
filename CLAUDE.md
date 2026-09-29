@AGENTS.md

- Requirements: `docs/personal-finance-dashboard-BRD.md`
- Tech decisions: @docs/tech-decisions.md (log new decisions there)
- Roadmap and current step: @docs/roadmap.md (update it at the end of each step)

## Rules

- **Work on `dev`; never commit or push to `main`** (TD-5). Commit and push straight to
  `dev`, which deploys to pre-prod. Pre-prod uses the production database, so anything
  done there changes real data. `main` changes only when the owner merges a PR from `dev`
  in GitHub: open one with `gh pr create --base main --head dev` when asked, but never
  merge it. Every merge to `main` deploys to production and can change the live
  database. Never bypass the rulesets or the pre-push hook.
- **This repo is public** (TD-6). Never commit the owner's real financial data or
  personal details. Examples, seed data and test fixtures must be made up.
