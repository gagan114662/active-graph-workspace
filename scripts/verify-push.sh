#!/bin/bash
# verify-push.sh — confirm a git push actually reached the remote.
#
# "Trust nothing about git push" discipline (per operator feedback 2026-05-28):
# every push must be verified against the remote SHA before being claimed as
# done. Push can succeed locally and silently leave the remote untouched
# (network reset mid-flight, server-side hook reject swallowed by CLI, wrong
# remote URL). The only proof a push landed: local HEAD SHA == remote ref SHA.
#
# Usage:
#   scripts/verify-push.sh                              # default: outer repo, main branch
#   scripts/verify-push.sh main                         # specific branch
#   scripts/verify-push.sh main activegraph             # inner repo
#   scripts/verify-push.sh flywheel-fixes-20260528      # named branch
#
# Exits 0 on verified, 1 on drift, 2 on lookup error.

set -e

BRANCH="${1:-main}"
REPO_DIR="${2:-.}"

cd "$REPO_DIR"

# Detect repo slug from origin URL (handles both git@ and https:// forms)
REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
if [ -z "$REMOTE_URL" ]; then
  echo "✗ no origin remote configured in $REPO_DIR" >&2
  exit 2
fi
SLUG=$(echo "$REMOTE_URL" | sed -E 's#(git@github\.com:|https://github\.com/)##' | sed 's#\.git$##')

LOCAL=$(git rev-parse HEAD)
LS_REMOTE=$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}')
GH_API=$(gh api "repos/$SLUG/branches/$BRANCH" --jq .commit.sha 2>/dev/null || echo "")

echo "verify-push: $SLUG@$BRANCH"
echo "  local HEAD: $LOCAL"
echo "  ls-remote:  $LS_REMOTE"
echo "  gh api:     $GH_API"

if [ -z "$LS_REMOTE" ] || [ -z "$GH_API" ]; then
  echo "  ✗ remote lookup returned empty — branch may not exist remotely"
  exit 2
fi

if [ "$LOCAL" = "$LS_REMOTE" ] && [ "$LOCAL" = "$GH_API" ]; then
  echo "  ✓ PUSH VERIFIED — remote tip matches local HEAD"
  exit 0
fi

echo "  ✗ DRIFT — local HEAD does not match remote tip"
echo "     local=$LOCAL"
echo "     remote=$LS_REMOTE"
exit 1
