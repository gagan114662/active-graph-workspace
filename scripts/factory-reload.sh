#!/bin/bash
# factory-reload.sh — restart only the daemons whose source files changed.
#
# Solves the "running stale code" failure mode that bit us 3× this week:
# I edit a script, the change works in isolation, but the live daemon
# still runs the old bytecode until manually bootout'd. This script:
#
#   1. Lists each managed daemon + the files it imports (transitively).
#   2. Hashes the current import set.
#   3. Compares to last-known hashes in ~/.factory/source-hashes.json.
#   4. For each daemon whose import set changed: launchctl bootout +
#      bootstrap so the next event uses the new code.
#   5. Saves the new hashes.
#
# Idempotent. Run after any edit that touches a tracked import file.
#
# Usage:
#   bash scripts/factory-reload.sh                # restart what changed
#   bash scripts/factory-reload.sh --dry-run      # show what would restart
#   bash scripts/factory-reload.sh --force        # restart everything anyway

set -euo pipefail

REPO="/Users/gaganarora/Desktop/my projects/active_graph"
STATE_DIR="$HOME/.factory"
HASH_FILE="$STATE_DIR/source-hashes.json"
mkdir -p "$STATE_DIR"

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1;;
    --force) FORCE=1;;
    *) ;;
  esac
done

UID_NUM=$(id -u)

# Parallel arrays — bash associative arrays choke on dotted keys.
LABELS=(
  "run.pentagon.trigger-bridge"
  "run.factory.honker-relay"
  "run.factory.sasha-skeptic"
  "run.factory.blake-budget-marshal"
  "run.factory.phoenix-todo-keeper"
)

# Files each daemon imports (transitively). Adding a new daemon: append
# to LABELS and to imports_for() below.
imports_for() {
  case "$1" in
    "run.pentagon.trigger-bridge")
      echo "scripts/pentagon-trigger-bridge.mjs scripts/factory-events.mjs scripts/factory-crash-guard.mjs scripts/bridge_dispatch.py activegraph/activegraph/llm/claude_code_cli.py"
      ;;
    "run.factory.honker-relay")
      echo "scripts/honker_relay.py"
      ;;
    "run.factory.sasha-skeptic")
      echo "scripts/sasha-skeptic.mjs scripts/factory-events.mjs scripts/honker-subscribe.mjs scripts/factory-crash-guard.mjs"
      ;;
    "run.factory.blake-budget-marshal")
      echo "scripts/blake-budget-marshal.mjs scripts/factory-events.mjs scripts/honker-subscribe.mjs scripts/factory-crash-guard.mjs"
      ;;
    "run.factory.phoenix-todo-keeper")
      echo "scripts/phoenix-todo-keeper.mjs scripts/factory-events.mjs scripts/honker-subscribe.mjs scripts/pentagon-rest.mjs scripts/factory-crash-guard.mjs"
      ;;
  esac
}

# Compute a content hash for a daemon's import set.
hash_imports() {
  local label="$1"
  local files
  files=$(imports_for "$label")
  local concat=""
  for f in $files; do
    local fpath="$REPO/$f"
    if [ -f "$fpath" ]; then
      concat+=$(shasum -a 256 "$fpath" | cut -d' ' -f1)
    fi
  done
  echo -n "$concat" | shasum -a 256 | cut -d' ' -f1
}

# Read previous hash for a label from the JSON state file.
prev_hash() {
  local label="$1"
  if [ ! -f "$HASH_FILE" ]; then
    echo ""
    return
  fi
  python3 -c "import json,sys; print(json.load(open('$HASH_FILE')).get('$label',''))" 2>/dev/null || echo ""
}

CHANGED=()
declare -a NEW_HASH_PAIRS
for label in "${LABELS[@]}"; do
  current=$(hash_imports "$label")
  previous=$(prev_hash "$label")
  if [ "$FORCE" = "1" ] || [ "$current" != "$previous" ]; then
    CHANGED+=("$label")
  fi
  NEW_HASH_PAIRS+=("$label=$current")
done

if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "no daemons changed; nothing to reload."
  exit 0
fi

echo "daemons with changed import set:"
for label in "${CHANGED[@]}"; do
  echo "  - $label"
done

if [ "$DRY_RUN" = "1" ]; then
  echo "(dry-run; not actually restarting)"
  exit 0
fi

# Restart each changed daemon.
for label in "${CHANGED[@]}"; do
  PLIST="$HOME/Library/LaunchAgents/$label.plist"
  if [ ! -f "$PLIST" ]; then
    echo "  $label: plist not found at $PLIST — skipping"
    continue
  fi
  echo "  $label: bootout..."
  launchctl bootout "gui/$UID_NUM/$label" 2>&1 || true
  # bootstrap can return exit 5 right after bootout; retry.
  for attempt in 1 2 3; do
    sleep 2
    if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
      break
    fi
    if [ "$attempt" = 3 ]; then
      echo "  $label: bootstrap failed after 3 attempts"
    fi
  done
  state=$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk -F' = ' '/^\tstate/ {print $2; exit}')
  pid=$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk -F' = ' '/^\tpid/ {print $2; exit}')
  echo "  $label: state=$state pid=${pid:-?}"
done

# Persist new hashes via Python so the JSON is well-formed.
python3 -c "
import json, sys
pairs = sys.argv[1:]
out = {}
for p in pairs:
    k, v = p.split('=', 1)
    out[k] = v
json.dump(out, open('$HASH_FILE', 'w'), indent=2)
" "${NEW_HASH_PAIRS[@]}"

echo ""
echo "reloaded ${#CHANGED[@]} daemon(s). new hashes at $HASH_FILE"
