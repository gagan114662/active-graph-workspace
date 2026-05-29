# Finding: the self-healing triage cannot be an in-runtime behavior on `behavior.failed`

**Date:** 2026-05-29. **Method:** two reference probes (`scripts/referee-factory/polsia/ref_triage.py`, `ref_triage_probe.py`), run against the real activegraph runtime.

## What the plan assumed
"Register a behavior/Pattern subscription that listens for `behavior.failed`; it wakes a Triage agent that forks, fixes, referees, and merges." (Step 3 of the live-flywheel plan, echoing the runtime talk.)

## What the trace actually shows
- `behavior.failed` IS emitted, is first-class, and does NOT crash the run (reaches `runtime.idle`). The PDF's "failures are first-class events" claim holds. ✅
- A behavior subscribed to `behavior.failed` **never fires** (`triage` never started; `remediation.requested` never emitted). ❌
- Confirmation probe: behaviors fire on **custom** events (`custom.signal` -> handler fired) but NOT on **lifecycle** events (`behavior.completed` -> handler did NOT fire).

## Conclusion (verified, not assumed)
The runtime records `behavior.*` lifecycle events but does not re-dispatch behaviors on them (loop-prevention). Therefore the self-healing flywheel CANNOT be an in-graph behavior on `behavior.failed`. It must be an **external monitor** that tails the event log for `behavior.failed` and dispatches remediation — which the dark factory already has (outer-repo `frames/factory-events.jsonl` watchers: Sasha/Phoenix), with the Referee Factory as the verify stage.

## Honest status of the flywheel engine
- Detection signal (`behavior.failed`, first-class, recorded): real. ✅
- In-runtime auto-wake (plan's Step 3): does NOT work. ❌ — corrected here.
- Correct mechanism: external event-log watcher + Referee Factory verify. Already exists in the outer repo; wiring it to the Polsia daemon's live failures is integration work (operator-gated), not an in-graph behavior.
