#!/usr/bin/env bash
# Stop hook: after a turn, if source code changed in the working tree but
# docs/CHANGELOG.md was left untouched, block the stop and wake Claude to
# evaluate documentation updates (CHANGELOG, ARCHITECTURE, directory CLAUDE.md).
#
# Deterministic trigger = CHANGELOG.md not touched while code changed.
# The broader "do ARCHITECTURE/CLAUDE.md need updating?" judgment is delegated
# back to Claude via the reason text — a hook can't reliably decide that.
#
# Wired from .claude/settings.json as a Stop hook. Receives hook JSON on stdin.
set -uo pipefail

input=$(cat)

# Loop guard: if this stop is already a continuation triggered by this hook,
# don't nag again — one nudge per stop cycle.
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
[ "$active" = "true" ] && exit 0

root=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}
[ -z "$root" ] && exit 0
cd "$root" || exit 0

# Working-tree changes (staged, unstaged, untracked), paths only.
# -uall lists untracked files individually instead of collapsing whole new
# directories to a single "dir/" entry, so docs paths are matched correctly.
paths=$(git status --porcelain -uall 2>/dev/null | cut -c4-)
[ -z "$paths" ] && exit 0

# Code = changed paths that are not Markdown docs and not .claude/ config.
code=$(printf '%s\n' "$paths" | grep -vE '(\.md$|^\.claude/)')
# Did the required changelog get touched?
changelog=$(printf '%s\n' "$paths" | grep -E '(^|/)CHANGELOG\.md$')

if [ -n "$code" ] && [ -z "$changelog" ]; then
  reason="You changed code but docs/CHANGELOG.md is untouched.

Per CLAUDE.md, after every change you must update docs/CHANGELOG.md (newest entry on top: what / why / files-areas / docs-touched).

Also evaluate whether these need updating and apply changes if so:
- docs/ARCHITECTURE.md — for any architectural deviation from the existing design; put new questions for the team in §11.
- The CLAUDE.md of each directory whose code changed (e.g. app/CLAUDE.md) — if conventions, layout, or commands shifted.

Changed code files:
${code}

If you have genuinely already covered the docs, say so and stop again to dismiss this."
  jq -cn --arg r "$reason" '{decision:"block", reason:$r}'
  exit 0
fi

exit 0
