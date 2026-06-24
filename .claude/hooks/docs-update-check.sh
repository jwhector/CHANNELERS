#!/usr/bin/env bash
# Stop hook: after a turn, if source code changed in the working tree but
# docs/CHANGELOG.md was left untouched, wake Claude ONCE to *judge* whether the
# docs need updating. This is an advisory nudge, not a mandatory gate — the
# whole point is that not every code change warrants a doc change.
#
# A hook can only see "code changed, CHANGELOG didn't" — it can't tell a
# substantive change from a trivial one, or whether ARCHITECTURE/CLAUDE.md is
# actually affected. So it delegates that judgment back to Claude via the reason
# text, which explicitly invites dismissal when the change doesn't merit a doc.
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
# Did the changelog get touched?
changelog=$(printf '%s\n' "$paths" | grep -E '(^|/)CHANGELOG\.md$')

if [ -n "$code" ] && [ -z "$changelog" ]; then
  reason="You changed code but docs/CHANGELOG.md is untouched. Decide whether this change warrants a doc update — this is a reminder to judge, not a requirement to write.

If the change is substantive (a feature, a behavior change, an architectural move), add a docs/CHANGELOG.md entry (newest on top: what / why / files-areas / docs-touched), and ONLY where actually affected:
- docs/ARCHITECTURE.md — only on a genuine architectural deviation; new team questions go in §12.
- A directory CLAUDE.md (e.g. app/CLAUDE.md) — only if its stack, routes, or conventions actually shifted.

If the change is trivial or a no-op for the docs (refactor, formatting, a fix that changes nothing a future session needs to know, or you've already updated what's needed), just stop again to dismiss this — no entry required.

Changed code files:
${code}"
  jq -cn --arg r "$reason" '{decision:"block", reason:$r}'
  exit 0
fi

exit 0
