# scripts/ — local resolver

> gbrain local-resolver pattern (P21). Master map: `../RESOLVER.md`. Before editing a file here,
> run `node scripts/resolve-context.mjs scripts/<file>` to load its routed context docs.

## What goes here
Orchestration + verification + flywheel + eval tooling for the dark factory:
- **Dispatch:** `pentagon-trigger-bridge.mjs` (THE dispatch path), `bridge_dispatch.py`,
  `pentagon-rest.mjs`, `pentagon-auth.mjs`, `run-native-pentagon-task.mjs`.
- **Verifier:** `verify-pentagon-autonomy-from-logs.mjs` (heart of the system) + `*.test.mjs`.
- **Routing/decisions:** `factory-routing.mjs` (shared `decideRoute`), `sasha-skeptic.mjs`.
- **Flywheel daemons:** `phoenix-todo-keeper.mjs`, `safety-monitor.mjs`, `blake-budget-marshal.mjs`,
  `honker_relay.py`, `f1-daemon.mjs`, `factory-alert.mjs`, `factory-rotate-logs.mjs`.
- **Events substrate:** `factory-events.mjs` / `factory_events.py`, `honker_*.py`, `factory-events-list.mjs`.
- **Eval loop:** `skillopt_judge_eval.py`, `eval-harvest-from-failures.mjs`, `grade-call.mjs`,
  `factory-replay.mjs`, `success-flow-capture.mjs`, `research-packet.mjs`, `resolve-context.mjs`.
- **Lifecycle:** `factory-activate.sh`, `factory-reload.sh`, `factory-deactivate.sh`, `factory-health.mjs`.

## What does NOT go here
- Specs, proofs, goal docs, runtime evidence → `frames/`.
- Contracts, rubrics, judge ground-truth, routing config, identity map → `agent-os/`.
- The inner Python package source → `activegraph/`.

## Conventions
- New decision/pure functions get a `*.test.mjs` (determinism is pinned by tests).
- Every failure/exit path emits a factory event (see `factory-events.mjs`); don't swallow silently.
- Daemons check the `~/.factory/PANIC` kill switch and honor Blake budget caps.
- After editing a daemon's import set, run `factory-reload.sh` to make it live.
