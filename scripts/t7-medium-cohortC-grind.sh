#!/bin/bash
# Sequential T7 medium cohort-C grind driver.
# Fires the remaining runs needed for the 25-run gate, ONE AT A TIME (the fire
# helper is not concurrency-safe: shared inner repo, pytest collect counts,
# worktrees). Stops on 3 consecutive failures (session-limit wall / infra storm)
# so it never burns a long tail of doomed dispatches.
#
# Usage: bash scripts/t7-medium-cohortC-grind.sh "9 10 15 16 17 18 19 20 21 22 23 24 25"
set -u
cd "/Users/gaganarora/Desktop/my projects/active_graph"
RUNS="${1:-9 10 15 16 17 18 19 20 21 22 23 24 25}"
LOG=/tmp/t7m-cohortC-grind.log
consec_fail=0
echo "[grind] start $(date -u +%FT%TZ) runs=[$RUNS]" | tee -a "$LOG"
for i in $RUNS; do
  echo "[grind] === firing run $i at $(date -u +%FT%TZ) ===" | tee -a "$LOG"
  node scripts/t7-medium-cohortC-opus48-fire.mjs "$i" >>"$LOG" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "[grind] run $i PASS (rc=0)" | tee -a "$LOG"
    consec_fail=0
  else
    echo "[grind] run $i NON-PASS rc=$rc" | tee -a "$LOG"
    consec_fail=$((consec_fail + 1))
    if [ "$consec_fail" -ge 3 ]; then
      echo "[grind] STOP — 3 consecutive non-pass runs (likely session limit / infra). Last rc=$rc" | tee -a "$LOG"
      exit 1
    fi
  fi
done
echo "[grind] DONE $(date -u +%FT%TZ)" | tee -a "$LOG"
