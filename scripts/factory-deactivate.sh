#!/bin/bash
# factory-deactivate.sh — turn the dark factory OFF.
#
# Boots out the 4 factory daemons. Does NOT touch the bridge LaunchAgent
# (that's a separate concern — Pentagon dispatch keeps working).
# Does NOT delete the plists from ~/Library/LaunchAgents — re-activate via
# factory-activate.sh.

set -euo pipefail

UID_NUM=$(id -u)

# Drop a PANIC file so any daemon still mid-bootout sees it and exits fast
# instead of completing in-flight work. The file lives for 30 seconds (long
# enough to win the daemon's 5s panic check), then gets cleared.
touch "$HOME/.factory/PANIC"
( sleep 30; rm -f "$HOME/.factory/PANIC" ) &

LABELS=(
  "run.factory.f1-daemon"
  "run.factory.alert"
  "run.factory.rotate-logs"
  "run.factory.phoenix-todo-keeper"
  "run.factory.blake-budget-marshal"
  "run.factory.sasha-skeptic"
  "run.factory.honker-relay"
)

for label in "${LABELS[@]}"; do
  if launchctl print "gui/$UID_NUM/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID_NUM/$label" 2>&1 || true
    echo "stopped $label"
  else
    echo "$label was not loaded"
  fi
done

echo ""
echo "factory daemons deactivated. bridge still running."
echo "to turn back on: scripts/factory-activate.sh"
