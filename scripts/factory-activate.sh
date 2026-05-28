#!/bin/bash
# factory-activate.sh — turn the dark factory ON.
#
# Installs and bootstraps the 4 factory daemons (honker-relay, sasha-skeptic,
# blake-budget-marshal, phoenix-todo-keeper) as user LaunchAgents.
#
# What this does:
#   1. Creates ~/.factory/ for daemon log files (if missing).
#   2. Copies the 4 plists from scripts/launch-agents/ into ~/Library/LaunchAgents/.
#   3. launchctl bootstrap each. The bridge stays running independently.
#
# Idempotent. Run again to pick up plist changes (you'll need to bootout first
# if a daemon is already running — `factory-deactivate.sh` first, then this).

set -euo pipefail

REPO="/Users/gaganarora/Desktop/my projects/active_graph"
PLIST_SRC="$REPO/scripts/launch-agents"
PLIST_DST="$HOME/Library/LaunchAgents"
UID_NUM=$(id -u)

mkdir -p "$HOME/.factory"
mkdir -p "$PLIST_DST"

# Clear any prior PANIC file from a previous deactivate.
rm -f "$HOME/.factory/PANIC"

LABELS=(
  "run.factory.honker-relay"
  "run.factory.sasha-skeptic"
  "run.factory.blake-budget-marshal"
  "run.factory.phoenix-todo-keeper"
  "run.factory.safety-monitor"
  "run.factory.rotate-logs"
  "run.factory.alert"
  "run.factory.f1-daemon"
)

for label in "${LABELS[@]}"; do
  src="$PLIST_SRC/$label.plist"
  dst="$PLIST_DST/$label.plist"
  if [ ! -f "$src" ]; then
    echo "missing source plist: $src" >&2
    exit 1
  fi
  cp "$src" "$dst"
  # If already loaded, bootout first so bootstrap picks up the new plist.
  if launchctl print "gui/$UID_NUM/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID_NUM/$label" 2>&1 || true
    sleep 1
  fi
  launchctl bootstrap "gui/$UID_NUM" "$dst"
  echo "loaded $label"
done

echo ""
echo "=== factory daemons status ==="
for label in "${LABELS[@]}"; do
  state=$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk -F' = ' '/^\tstate/ {print $2; exit}')
  pid=$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk -F' = ' '/^\tpid/ {print $2; exit}')
  echo "  $label: state=$state pid=${pid:-?}"
done

echo ""
echo "=== honker substrate health check ==="
# Wait for honker-relay to be ready (it tails JSONL → SQLite, needs both alive)
sleep 2
HEALTH_OUT=$("$REPO/scripts/factory-honker-healthcheck.mjs" 2>&1 || true)
echo "$HEALTH_OUT"
if echo "$HEALTH_OUT" | grep -q "HONKER_HEALTHY"; then
  echo "  honker substrate verified end-to-end"
else
  echo "  WARNING: honker substrate did NOT respond — events may not surface to consumers"
  echo "  check: tail ~/.factory/honker-relay.err.log"
fi

echo ""
echo "factory activated. logs at ~/.factory/. monitor via: node scripts/factory-health.mjs"
echo "to turn off: scripts/factory-deactivate.sh"
