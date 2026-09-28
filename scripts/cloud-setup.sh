#!/usr/bin/env bash
# SessionStart hook: prepares Claude Code cloud sessions (claude.ai/code).
# No-op on local machines.
set -euo pipefail

[ -n "${CLAUDE_CODE_REMOTE:-}" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

# Bun is not preinstalled in the cloud image; npm's registry is allowlisted.
if ! command -v bun >/dev/null 2>&1; then
  bun_version=$(node -p "require('./package.json').packageManager.split('@')[1]")
  npm install -g "bun@${bun_version}"
fi

bun install --frozen-lockfile
