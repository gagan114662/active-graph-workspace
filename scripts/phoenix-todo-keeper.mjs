#!/usr/bin/env node
// Phoenix (Todo Keeper) — the consumer side of the closed-loop flywheel.
//
// Subscribes to factory events in realtime via honker. For each todo.created
// event, maintains the persistent todo backlog at frames/factory-todos.jsonl
// with:
//   * dedup: a recurring failure (same dedup_key) increments the existing
//     todo's occurrence counter instead of creating a duplicate row
//   * priority aging: a p2 that's been open > 24h gets bumped to p1
//   * completion tracking: when todo.completed events arrive, the matching
//     todo row is marked done with completed_at + evidence
//
// What Phoenix does NOT do (yet — task is still in flight):
//   * Insert Pentagon agent_triggers automatically. The extension point is
//     marked with TODO(pentagon-dispatch). Adding it makes the loop fully
//     autonomous; until then, the operator pulls from frames/factory-todos.jsonl.
//
// Usage:
//   node scripts/phoenix-todo-keeper.mjs               # foreground
//   node scripts/phoenix-todo-keeper.mjs --dry-run     # log decisions, no JSONL writes
//   node scripts/phoenix-todo-keeper.mjs --legacy-poll # bypass honker
//
// To run 24/7, wrap in a LaunchAgent plist similar to sasha-skeptic's.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { subscribeToFactoryEvents } from "./honker-subscribe.mjs";
import { emitFactoryEvent, emitStateMutation, hashGitState, hashFileState } from "./factory-events.mjs";
import { dispatchTodo, dispatchReviewer } from "./pentagon-rest.mjs";
import { acquireLock } from "./_lockfile.mjs";

installCrashGuard("phoenix-todo-keeper");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const TODOS_PATH = resolve(
  process.env.FACTORY_TODOS_PATH || "frames/factory-todos.jsonl"
);
const DRY_RUN = has("--dry-run");
const LEGACY_POLL = has("--legacy-poll");
const AGE_TO_P1_HOURS = Number(arg("--age-to-p1-hours", "24"));

// Autonomous Pentagon dispatch — opt-in. Off by default so existing
// deployments don't suddenly start spawning agent_triggers; turn on with
// --autodispatch (or env FACTORY_TODO_AUTODISPATCH=1).
const AUTODISPATCH =
  has("--autodispatch") ||
  process.env.FACTORY_TODO_AUTODISPATCH === "1" ||
  process.env.FACTORY_TODO_AUTODISPATCH === "true";

// Rate limit: max N new dispatches per ROLLING window (default: 5 per 60s).
// Recurring failures dedup before they ever reach dispatch, so this only
// guards against bursty distinct-failure storms.
const DISPATCH_MAX_PER_WINDOW = Number(arg("--dispatch-max-per-window", "5"));
const DISPATCH_WINDOW_MS = Number(arg("--dispatch-window-ms", "60000"));

// Circuit breaker: if N consecutive dispatches fail, pause dispatching for
// COOLDOWN_MS (default 5m). Auto-resets on first success.
const DISPATCH_CIRCUIT_THRESHOLD = Number(arg("--dispatch-circuit-threshold", "3"));
const DISPATCH_CIRCUIT_COOLDOWN_MS = Number(arg("--dispatch-circuit-cooldown-ms", "300000"));
// C3/C4: the review gate FAILS CLOSED by default. Reviewer-dispatch failure,
// review timeout, or a malformed reply parks the todo in needs_review (no
// ungated commit) unless the operator explicitly opts into degraded
// auto-commit. Set --allow-ungated-fallback (or FACTORY_ALLOW_UNGATED_FALLBACK=1)
// to restore the old land-anyway behavior.
const ALLOW_UNGATED_FALLBACK = has("--allow-ungated-fallback") ||
  process.env.FACTORY_ALLOW_UNGATED_FALLBACK === "1";
// Sentinel safety gate: a `safety.blocked` verdict ALWAYS blocks the push.
// With --require-safety (or FACTORY_REQUIRE_SAFETY=1) the push also requires an
// explicit `safety.allowed` — fail-closed for unattended autodispatch.
const REQUIRE_SAFETY = has("--require-safety") ||
  process.env.FACTORY_REQUIRE_SAFETY === "1";
// pt.18 Phase 3: AUTONOMOUS MERGE. Default OFF. Only the safest path ever lands to
// main without a human: gh pr merge --auto (GitHub merges only after required CI —
// branch protection requires deploy-verification) gated by Rowan PASS + a FRESH
// Sentinel safety.allowed + REQUIRE_SAFETY. Enable with --auto-merge or FACTORY_AUTO_MERGE=1.
const AUTO_MERGE = has("--auto-merge") || process.env.FACTORY_AUTO_MERGE === "1";

const counts = {
  events_seen: 0,
  todos_created: 0,
  todos_deduped: 0,
  todos_completed: 0,
  malformed_events: 0,
  dispatches_attempted: 0,
  dispatches_succeeded: 0,
  dispatches_failed: 0,
  dispatches_skipped_rate_limit: 0,
  dispatches_skipped_circuit_open: 0,
  dispatches_skipped_dry_run: 0,
};

const dispatchTimestamps = [];   // ms timestamps of recent dispatch attempts
let dispatchCircuitOpenUntil = 0;
let dispatchConsecutiveFailures = 0;

function rateLimitOk() {
  const now = Date.now();
  const cutoff = now - DISPATCH_WINDOW_MS;
  while (dispatchTimestamps.length && dispatchTimestamps[0] < cutoff) {
    dispatchTimestamps.shift();
  }
  return dispatchTimestamps.length < DISPATCH_MAX_PER_WINDOW;
}

function circuitOk() {
  return Date.now() >= dispatchCircuitOpenUntil;
}

// In-memory index: dedup_key → todo row. Reloaded from disk at startup.
const index = new Map();

function ensureTodosFile() {
  if (!existsSync(TODOS_PATH)) {
    mkdirSync(dirname(TODOS_PATH), { recursive: true });
    if (!DRY_RUN) writeFileSync(TODOS_PATH, "");
  }
}

function loadExistingTodos() {
  if (!existsSync(TODOS_PATH)) return;
  const lines = readFileSync(TODOS_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.dedup_key) index.set(row.dedup_key, row);
    } catch {
      counts.malformed_events++;
    }
  }
  console.log(
    JSON.stringify({
      status: "phoenix_loaded_existing_todos",
      count: index.size,
      open: [...index.values()].filter((t) => !t.completed_at).length,
    })
  );
}

function persistRow(row) {
  if (DRY_RUN) return;
  appendFileSync(TODOS_PATH, JSON.stringify(row) + "\n");
}

function rewriteAllTodos() {
  // Used after marking todos completed — append-only would leave the JSONL
  // ambiguous (latest-row-wins). Rewriting is cheap for typical sizes.
  if (DRY_RUN) return;
  const tmpPath = TODOS_PATH + ".rewriting";
  const data = [...index.values()].map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, TODOS_PATH);
}

function handleTodoCreated(event) {
  const payload = event.payload || {};
  const dedupKey = payload.dedup_key;
  if (!dedupKey) {
    counts.malformed_events++;
    console.error("[phoenix] todo.created missing dedup_key", event.id);
    return;
  }
  const existing = index.get(dedupKey);
  if (existing && !existing.completed_at) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen_at = event.created_at;
    existing.last_failure_event_id = payload.failure_event_id;
    counts.todos_deduped++;
    // Age open todos: bump to p1 if they've been open long enough.
    const openHours =
      (Date.parse(existing.last_seen_at) - Date.parse(existing.created_at)) /
      3_600_000;
    if (
      existing.priority === "p2" &&
      openHours >= AGE_TO_P1_HOURS &&
      !existing._aged_to_p1
    ) {
      existing.priority = "p1";
      existing._aged_to_p1 = true;
    }
    rewriteAllTodos();
    console.log(
      JSON.stringify({
        status: "phoenix_deduped",
        dedup_key: dedupKey,
        occurrences: existing.occurrences,
        priority: existing.priority,
      })
    );
    return;
  }
  const row = {
    id: "todo_" + (event.id || Date.now()),
    created_at: event.created_at,
    last_seen_at: event.created_at,
    completed_at: null,
    dedup_key: dedupKey,
    title: payload.title || "(no title)",
    failure_event_id: payload.failure_event_id,
    last_failure_event_id: payload.failure_event_id,
    failure_reason: payload.failure_reason,
    recommended_agent: payload.recommended_agent,
    priority: payload.priority || "p2",
    occurrences: 1,
    source_event_type: payload.source_event_type || null,
    source_behavior: payload.source_behavior || null,
  };
  index.set(dedupKey, row);
  persistRow(row);
  counts.todos_created++;
  console.log(
    JSON.stringify({
      status: "phoenix_created",
      dedup_key: dedupKey,
      todo_id: row.id,
      recommended_agent: row.recommended_agent,
      priority: row.priority,
    })
  );

  // Autonomous Pentagon dispatch — completes the closed loop.
  maybeDispatch(row);
}

async function maybeDispatch(row) {
  if (!AUTODISPATCH) return;
  counts.dispatches_attempted++;
  if (DRY_RUN) {
    counts.dispatches_skipped_dry_run++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_dry_run",
        todo_id: row.id,
        recommended_agent: row.recommended_agent,
      })
    );
    return;
  }
  if (!circuitOk()) {
    counts.dispatches_skipped_circuit_open++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_circuit_open",
        todo_id: row.id,
        cooldown_remaining_ms: dispatchCircuitOpenUntil - Date.now(),
      })
    );
    return;
  }
  if (!rateLimitOk()) {
    counts.dispatches_skipped_rate_limit++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_rate_limit",
        todo_id: row.id,
        recent_dispatches: dispatchTimestamps.length,
        window_ms: DISPATCH_WINDOW_MS,
        max_per_window: DISPATCH_MAX_PER_WINDOW,
      })
    );
    return;
  }
  dispatchTimestamps.push(Date.now());
  try {
    const result = await dispatchTodo(row);
    counts.dispatches_succeeded++;
    dispatchConsecutiveFailures = 0;
    row.dispatched_at = new Date().toISOString();
    row.dispatched_conversation_id = result.conversation_id;
    row.dispatched_message_id = result.message_id;
    row.dispatched_target_agent_id = result.target_agent_id;
    rewriteAllTodos();
    try {
      emitFactoryEvent({
        type: "todo.dispatched",
        behavior: "factory-flywheel",
        extras: {
          todo_id: row.id,
          dedup_key: row.dedup_key,
          recommended_agent: row.recommended_agent,
          conversation_id: result.conversation_id,
          message_id: result.message_id,
        },
      });
    } catch {}
    console.log(
      JSON.stringify({
        status: "phoenix_dispatched",
        todo_id: row.id,
        recommended_agent: row.recommended_agent,
        conversation_id: result.conversation_id,
        message_id: result.message_id,
      })
    );
  } catch (err) {
    counts.dispatches_failed++;
    dispatchConsecutiveFailures++;
    if (dispatchConsecutiveFailures >= DISPATCH_CIRCUIT_THRESHOLD) {
      dispatchCircuitOpenUntil = Date.now() + DISPATCH_CIRCUIT_COOLDOWN_MS;
      console.error(
        JSON.stringify({
          status: "phoenix_dispatch_circuit_opened",
          consecutive_failures: dispatchConsecutiveFailures,
          cooldown_ms: DISPATCH_CIRCUIT_COOLDOWN_MS,
        })
      );
    }
    console.error(
      JSON.stringify({
        status: "phoenix_dispatch_failed",
        todo_id: row.id,
        error: String(err?.message ?? err).slice(0, 500),
        consecutive_failures: dispatchConsecutiveFailures,
      })
    );
    try {
      emitFactoryEvent({
        type: "behavior.failed",
        behavior: "phoenix-todo-keeper",
        reason: "phoenix.dispatch_failed",
        message: String(err?.message ?? err).slice(0, 500),
        extras: {
          todo_id: row.id,
          recommended_agent: row.recommended_agent,
        },
      });
    } catch {}
  }
}

function handleTodoCompletion(event) {
  // Completion can arrive in multiple shapes:
  //   1. Explicit todo.completed event from Phoenix itself (carries the
  //      real dedup_key).
  //   2. Implicit behavior.completed with extras.todo_id set (bridge does
  //      this for FLYWHEEL_TODO-originated triggers).
  //   3. todo.completed from the bridge where dedup_key is actually a
  //      todo_id (bridge doesn't carry the real dedup_key — see
  //      pentagon-trigger-bridge.mjs::emitTodoCompleted).
  const payload = event.payload || {};
  const candidateDedupKey = payload.dedup_key || null;
  const candidateTodoId = payload.todo_event_id || payload.todo_id || null;
  let dedupKey = null;

  // First try as a real dedup_key.
  if (candidateDedupKey && index.has(candidateDedupKey)) {
    dedupKey = candidateDedupKey;
  }
  // Otherwise, treat any candidate as a possible todo_id and reverse lookup.
  if (!dedupKey) {
    const probeId = candidateTodoId || candidateDedupKey;
    if (probeId) {
      for (const [k, row] of index) {
        if (row.id === probeId) {
          dedupKey = k;
          break;
        }
      }
    }
  }
  if (!dedupKey) return;  // not a flywheel-attributed completion
  const row = index.get(dedupKey);
  if (!row || row.completed_at) return;
  row.completed_at = event.created_at;
  row.completion_event_id = event.id;
  row.completion_evidence = payload.completion_evidence || null;
  // Capture the reply-quality signal the bridge surfaces, so operator
  // audits can spot agents that ignored the receipt-string contract.
  if (typeof payload.receipt_string_present === "boolean") {
    row.receipt_string_present = payload.receipt_string_present;
  }
  if (typeof payload.reply_chars === "number") {
    row.reply_chars = payload.reply_chars;
  }
  counts.todos_completed++;
  rewriteAllTodos();
  console.log(
    JSON.stringify({
      status: "phoenix_completed",
      dedup_key: dedupKey,
      todo_id: row.id,
      completion_event_id: event.id,
      receipt_string_present: row.receipt_string_present ?? null,
    })
  );
}

function processEvent(event) {
  counts.events_seen++;
  if (event.type === "todo.created") {
    handleTodoCreated(event);
  } else if (event.type === "todo.completed") {
    handleTodoCompletion(event);
  } else if (event.type === "flywheel.diff.proposed") {
    // Action layer phase 1 (task #15): apply diff, run tests. If tests
    // pass, dispatch reviewer (Rowan) instead of committing directly.
    handleDiffProposed(event);
  } else if (event.type === "flywheel.review.completed") {
    // Action layer phase 2 (task #16): reviewer issued verdict.
    // PASS → commit + push. FAIL → revert + emit attempt.rejected.
    handleReviewCompleted(event);
  } else if (event.type === "factory.config.approved") {
    // Operator-approved a factory-learn proposal (task #20).
    // Apply the corresponding factory.config.proposed payload to the
    // routing config. Sasha auto-reloads on file change.
    handleConfigApproved(event);
  } else if (event.type === "flywheel.review.malformed") {
    // Bridge detected an agent reply that didn't match the judge ack
    // contract. Treat as protocol_drift judge.error and fall back to
    // direct commit (Gap C from the audit).
    handleReviewMalformed(event);
  }
  // Also consider any behavior.completed with extras.todo_id as an implicit
  // todo completion (lets agents close their assigned todos by emitting the
  // standard completion event with a todo_id tag).
  if (event.type === "behavior.completed" && event.payload?.todo_id) {
    handleTodoCompletion(event);
  }
}

// --- Operator approval path (task #20) ---

const ROUTING_CONFIG_PATH = resolve(
  process.env.FACTORY_ROUTING_CONFIG ||
    "/Users/gaganarora/Desktop/my projects/active_graph/agent-os/factory-routing-config.json"
);

function findProposedEventInLog(proposedEventId) {
  // Walk the JSONL backwards (most recent first) and stop at the matching
  // proposal id. Bounded scan to keep it cheap.
  const eventsPath = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
  if (!existsSync(eventsPath)) return null;
  const lines = readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5000); i--) {
    try {
      const ev = JSON.parse(lines[i]);
      if (ev.id === proposedEventId && ev.type === "factory.config.proposed") return ev;
    } catch {}
  }
  return null;
}

function applyProposalsToConfig(currentConfig, proposals) {
  const next = JSON.parse(JSON.stringify(currentConfig));
  next.rules = next.rules || [];
  for (const p of proposals) {
    // For each (reason, behavior) tuple, insert a new rule BEFORE the
    // existing matching rule so the new agent is preferred. The new
    // rule's `when` is the most specific predicate that captures this
    // tuple: reason_equals + behavior_equals.
    const newRule = {
      name: `learned_${p.key.reason}_${p.key.behavior}_${p.proposed.agent}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 80),
      when: { reason_equals: p.key.reason, behavior_equals: p.key.behavior },
      route: { agent: p.proposed.agent, priority: p.current_priority || "p1" },
      rationale: `factory-learn proposal: ${p.proposed.agent} had ${(p.proposed.rate * 100).toFixed(1)}% success vs ${p.current.agent}'s ${(p.current.rate * 100).toFixed(1)}% over ${p.proposed.dispatched}+${p.current.dispatched} dispatches (improvement ${p.improvement_pp}pp)`,
      learned: true,
      learned_at: new Date().toISOString(),
    };
    // Insert at the top of the rules so it's matched FIRST.
    next.rules.unshift(newRule);
  }
  next.last_updated = new Date().toISOString().slice(0, 10);
  return next;
}

function handleConfigApproved(event) {
  const proposedEventId = event.payload?.proposed_event_id;
  if (!proposedEventId) {
    console.error("[phoenix] factory.config.approved missing proposed_event_id");
    return;
  }
  const proposal = findProposedEventInLog(proposedEventId);
  if (!proposal) {
    console.error(`[phoenix] could not find factory.config.proposed event ${proposedEventId}`);
    emitFactoryEvent({
      type: "factory.config.apply_failed",
      behavior: "factory-flywheel",
      reason: "config.proposal_not_found",
      message: `proposal event ${proposedEventId} not found in log`,
      extras: { approval_event_id: event.id, proposed_event_id: proposedEventId },
    });
    return;
  }
  const proposals = proposal.payload?.proposals || [];
  if (proposals.length === 0) {
    console.error("[phoenix] proposal has empty proposals array; nothing to apply");
    return;
  }
  let currentConfig;
  try {
    currentConfig = JSON.parse(readFileSync(ROUTING_CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("[phoenix] failed to read current routing config:", e.message);
    return;
  }
  const newConfig = applyProposalsToConfig(currentConfig, proposals);
  // H4 / CRUD-replay: hash the routing config before + after the write and emit
  // a state-mutation event. The routing config governs all dispatch; without
  // this, replay can't reconstruct it from the log alone.
  const cfgBefore = hashFileState(ROUTING_CONFIG_PATH);
  // Write atomically.
  const tmpPath = ROUTING_CONFIG_PATH + ".applying";
  writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
  renameSync(tmpPath, ROUTING_CONFIG_PATH);
  const cfgAfter = hashFileState(ROUTING_CONFIG_PATH);
  try {
    emitStateMutation({
      type: "state.config_apply",
      behavior: "factory-flywheel",
      mutation_kind: "file_write",
      state_before_hash: cfgBefore,
      state_after_hash: cfgAfter,
      target: ROUTING_CONFIG_PATH,
      extras: {
        approval_event_id: event.id,
        proposed_event_id: proposedEventId,
        proposals_applied: proposals.length,
      },
    });
  } catch {}
  emitFactoryEvent({
    type: "factory.config.applied",
    behavior: "factory-flywheel",
    extras: {
      approval_event_id: event.id,
      proposed_event_id: proposedEventId,
      proposals_applied: proposals.length,
      rules_added: proposals.map((p) => `learned_${p.key.reason}_${p.proposed.agent}`),
      state_before_hash: cfgBefore,
      state_after_hash: cfgAfter,
    },
  });
  console.log(JSON.stringify({
    status: "phoenix_config_applied",
    proposed_event_id: proposedEventId,
    rules_added: proposals.length,
  }));
}

// --- Action layer (task #15) ---

const INNER_REPO = "/Users/gaganarora/Desktop/my projects/active_graph/activegraph";
const FLYWHEEL_FIX_BRANCH_PREFIX = "flywheel-fixes-";

// In-memory map of held action locks. Keyed by todoId. Lock-release callbacks
// are NOT serializable to JSON so they must live outside the persisted row.
const actionLocks = new Map();
function releaseActionLock(todoId) {
  const fn = actionLocks.get(todoId);
  if (fn) {
    try { fn(); } catch {}
    actionLocks.delete(todoId);
  }
}

function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd || INNER_REPO,
    encoding: "utf8",
    timeout: 120000,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function todayBranchName() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${FLYWHEEL_FIX_BRANCH_PREFIX}${d}`;
}

function handleDiffProposed(event) {
  const payload = event.payload || {};
  const todoId = payload.todo_event_id;
  if (!todoId) {
    console.error("[phoenix] flywheel.diff.proposed missing todo_event_id; skipping");
    return;
  }
  // Per-todo lock (Gap F). Prevents two phoenix instances (or a phoenix +
  // operator manual replay) from racing on the same todo's worktree path
  // and fix-branch refs. Released by rejectAttempt or by the
  // commitAndPushFromWorktree end-of-flow path.
  const todoLock = acquireLock(`flywheel-todo-${todoId.slice(0, 64)}`, { ttlMs: 30 * 60 * 1000 });
  if (!todoLock) {
    console.error(`[phoenix] could not acquire todo lock for ${todoId}; another instance may be processing this todo`);
    return;
  }
  // Find the matching todo row (must exist + still be open).
  let row = null;
  let dedupKey = null;
  for (const [k, r] of index) {
    if (r.id === todoId) { row = r; dedupKey = k; break; }
  }
  if (!row) {
    try { todoLock(); } catch {}
    console.error(`[phoenix] flywheel.diff.proposed for unknown todo ${todoId}; skipping`);
    return;
  }
  if (row.completed_at) {
    try { todoLock(); } catch {}
    console.error(`[phoenix] todo ${todoId} already completed; skipping diff application`);
    return;
  }
  if (row.diff_attempted_at) {
    try { todoLock(); } catch {}
    console.error(`[phoenix] todo ${todoId} already had a diff attempt; skipping duplicate`);
    return;
  }
  row.diff_attempted_at = new Date().toISOString();
  actionLocks.set(todoId, todoLock);
  rewriteAllTodos();

  const diff = Buffer.from(payload.diff_b64 || "", "base64").toString("utf8");
  if (!diff.trim()) {
    rejectAttempt(row, dedupKey, event, "empty diff");
    return;
  }

  const worktreePath = `/tmp/flywheel-${todoId.replace(/[^a-z0-9_-]/gi, "")}`;
  // Clean up any leftover worktree from a prior attempt.
  try { rmSync(worktreePath, { recursive: true, force: true }); } catch {}
  try {
    git(["worktree", "prune"], { cwd: INNER_REPO });
  } catch {}

  // Base the worktree on the day's fix branch if it exists (so successive
  // flywheel commits chain into a linear history that can be pushed),
  // otherwise off main. The fix branch ref is what update-ref will move
  // forward after the commit + tests succeed.
  const fixBranch = todayBranchName();
  // Sync local fix branch with remote first to avoid stale-tip push rejections.
  // If origin has commits we don't, fast-forward our local ref before creating
  // the worktree.
  git(["fetch", "origin", fixBranch], { cwd: INNER_REPO });
  const localFixSha = git(["rev-parse", "--verify", "-q", fixBranch], { cwd: INNER_REPO }).stdout.trim();
  const remoteFixSha = git(["rev-parse", "--verify", "-q", `origin/${fixBranch}`], { cwd: INNER_REPO }).stdout.trim();
  let base = "main";
  if (remoteFixSha) {
    // Sync local fix branch ref to remote so the worktree starts at the latest
    // landed commit. Avoids "non-fast-forward" push rejections after the new
    // commit lands.
    git(["update-ref", `refs/heads/${fixBranch}`, remoteFixSha], { cwd: INNER_REPO });
    base = fixBranch;
  } else if (localFixSha) {
    base = fixBranch;
  }

  const wt = git(["worktree", "add", "-B", `flywheel-attempt-${todoId.slice(0, 24)}`, worktreePath, base], { cwd: INNER_REPO });
  if (wt.status !== 0) {
    rejectAttempt(row, dedupKey, event, `worktree create failed: ${wt.stderr.slice(0, 200)}`);
    return;
  }

  // Apply the diff inside the worktree. Pre-check with --check first so
  // mal-formed diffs surface as a structured rejection rather than a partial-apply mess.
  const diffPath = `${worktreePath}/.flywheel-proposed.diff`;
  writeFileSync(diffPath, diff);
  const check = spawnSync("git", ["apply", "--check", diffPath], { cwd: worktreePath, encoding: "utf8" });
  if (check.status !== 0) {
    rejectAttempt(row, dedupKey, event, `git apply --check failed: ${check.stderr.slice(0, 300)}`, worktreePath);
    return;
  }
  const apply = spawnSync("git", ["apply", diffPath], { cwd: worktreePath, encoding: "utf8" });
  if (apply.status !== 0) {
    rejectAttempt(row, dedupKey, event, `git apply failed: ${apply.stderr.slice(0, 300)}`, worktreePath);
    return;
  }
  // Remove the .flywheel-proposed.diff file before staging (don't commit it).
  try { rmSync(diffPath); } catch {}

  // Run the test suite. Per CLAUDE.md c1c2603 we should prefer
  // .venv/bin/python -m pytest. The fresh worktree won't have .venv
  // (gitignored), so fall back to:
  //   1. inner repo's .venv (mounted into worktree by symlink)
  //   2. uv run pytest (uses pyproject.toml + lockfile)
  //   3. /opt/homebrew/bin/python3 -m pytest (last resort)
  //
  // The inner repo's .venv path is stable. Symlink it into the worktree
  // so any test code that resolves modules through .venv finds them.
  const innerVenv = `${INNER_REPO}/.venv`;
  const worktreeVenv = `${worktreePath}/.venv`;
  if (existsSync(innerVenv) && !existsSync(worktreeVenv)) {
    try { spawnSync("ln", ["-s", innerVenv, worktreeVenv], { encoding: "utf8" }); }
    catch (e) { console.error(`[phoenix] best-effort venv symlink failed: ${e?.message ?? e}`); }
  }

  let pytest;
  if (existsSync(`${worktreePath}/.venv/bin/python`)) {
    pytest = spawnSync(`${worktreePath}/.venv/bin/python`, ["-m", "pytest", "-q", "--maxfail=5", "-x"], {
      cwd: worktreePath,
      encoding: "utf8",
      timeout: 300_000,
    });
  } else {
    // Fall back to uv run if available, else system python3.
    const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
    if (uv.status === 0) {
      pytest = spawnSync("uv", ["run", "pytest", "-q", "--maxfail=5", "-x"], {
        cwd: worktreePath,
        encoding: "utf8",
        timeout: 300_000,
      });
    } else {
      pytest = spawnSync("python3", ["-m", "pytest", "-q", "--maxfail=5", "-x"], {
        cwd: worktreePath,
        encoding: "utf8",
        timeout: 300_000,
      });
    }
  }
  if (pytest.error || pytest.status !== 0) {
    rejectAttempt(row, dedupKey, event,
      `tests failed (status=${pytest.status}, error=${pytest.error?.code || "none"}): ${(pytest.stdout + pytest.stderr).slice(-500)}`,
      worktreePath);
    return;
  }

  const testSummaryLine = (pytest.stdout || "").split("\n").reverse()
    .find((l) => /passed|failed|skipped|error/.test(l)) || "(no summary line)";

  // Tests pass — stage in the worktree (preserves diff state across review)
  // then dispatch Rowan as code reviewer. Commit + push happens in phase 2
  // (handleReviewCompleted) only if Rowan PASSes.
  spawnSync("git", ["add", "-A"], { cwd: worktreePath });

  // Persist enough state for handleReviewCompleted to resume:
  row.action_phase = "awaiting_review";
  row.worktree_path = worktreePath;
  row.diff_b64 = payload.diff_b64;
  row.diff_rationale = payload.rationale || null;
  row.test_summary = testSummaryLine.slice(0, 200);
  row.source_event_id = event.id;
  // H7: mark the dispatch as PENDING synchronously, BEFORE the async call, so a
  // crash mid-dispatch is distinguishable from "never dispatched" (the .then
  // clears it on settle). Without this, the metadata is only written after the
  // promise resolves — a crash in between looked identical to no dispatch.
  row.review_dispatch_pending = true;
  rewriteAllTodos();

  // Dispatch Rowan with the rubric inline. dispatchReviewer is async; we
  // fire-and-forget here. The bridge's flywheel.review.completed event
  // will land within ~60s and re-enter this daemon via handleReviewCompleted.
  const diffText = Buffer.from(payload.diff_b64 || "", "base64").toString("utf8");
  dispatchReviewer({
    reviewerAgentKey: "rowan",
    todo: row,
    diff: diffText,
    rationale: payload.rationale,
    testSummary: testSummaryLine,
    failureContext: { reason: row.failure_reason, behavior: row.source_behavior },
  })
    .then((info) => {
      row.review_dispatch_pending = false;  // H7: settled cleanly
      row.review_dispatched_at = new Date().toISOString();
      row.review_conversation_id = info.conversation_id;
      row.review_message_id = info.message_id;
      row.review_reviewer_agent_id = info.reviewer_agent_id;
      row.review_reviewer_agent_key = info.reviewer_agent_key;
      rewriteAllTodos();
      console.log(JSON.stringify({
        status: "phoenix_review_dispatched",
        todo_id: row.id,
        reviewer: info.reviewer_agent_key,
        message_id: info.message_id,
      }));
    })
    .catch((err) => {
      console.error("[phoenix] dispatchReviewer failed:", err.message);
      row.review_dispatch_pending = false;  // H7: settled (failed)
      // Reviewer dispatch failed — fall back to direct commit (degraded mode)
      // so we don't strand the todo. Surface the failure as a factory event.
      emitFactoryEvent({
        type: "behavior.failed",
        behavior: "phoenix-todo-keeper",
        reason: "phoenix.reviewer_dispatch_failed",
        message: String(err.message || err).slice(0, 280),
        extras: { todo_id: row.id, reviewer: "rowan" },
      });
      // C3: fail closed — do NOT auto-land an unreviewed commit.
      handleReviewBypass(row, dedupKey, event, "dispatch_failed");
    });
  // Phase 1 done — actual commit deferred to phase 2.
  return;
}

function handleReviewMalformed(event) {
  const payload = event.payload || {};
  const todoId = payload.todo_event_id;
  if (!todoId) return;
  let row = null;
  let dedupKey = null;
  for (const [k, r] of index) {
    if (r.id === todoId && r.action_phase === "awaiting_review") {
      row = r; dedupKey = k; break;
    }
  }
  if (!row) return;
  // Record the protocol_drift error against the reviewer (so judge-accuracy
  // tracks the bad ack), then fall back to direct commit.
  emitFactoryEvent({
    type: "judge.error",
    behavior: "factory-eval-the-eval",
    reason: "judge.protocol_drift",
    message: `reviewer ${payload.reviewer_agent_name || "unknown"} replied without following ack contract`,
    extras: {
      judge: row.review_reviewer_agent_key || "rowan",
      original_verdict_event_id: event.id,
      downstream_evidence_event_id: event.id,
      error_kind: "protocol_drift",
      todo_event_id: todoId,
      reply_first_200: payload.reply_first_200,
    },
  });
  console.log(JSON.stringify({
    status: "phoenix_review_malformed_fallback",
    todo_id: row.id,
  }));
  row.review_judge = "rowan";
  row.review_completed_at = event.created_at;
  rewriteAllTodos();
  // C3: malformed reviewer reply = no valid verdict. Fail closed.
  handleReviewBypass(row, dedupKey, event, "malformed");
}

// Periodic check: any row stuck in awaiting_review past the timeout falls
// back to direct commit (Gap B). Runs every 60s.
const REVIEW_TIMEOUT_MS = Number(arg("--review-timeout-ms", "600000"));  // 10min default
function scanStuckReviews() {
  const now = Date.now();
  for (const [dedupKey, row] of index) {
    if (row.action_phase !== "awaiting_review") continue;
    if (row.review_timeout_handled) continue;  // already timed out
    if (!row.diff_attempted_at) continue;
    const age = now - Date.parse(row.diff_attempted_at);
    if (age < REVIEW_TIMEOUT_MS) continue;
    row.review_timeout_handled = true;
    row.review_judge = "rowan";
    row.review_completed_at = new Date().toISOString();
    rewriteAllTodos();
    emitFactoryEvent({
      type: "judge.error",
      behavior: "factory-eval-the-eval",
      reason: "judge.skipped_when_needed",
      message: `review timeout after ${Math.round(age/1000)}s`,
      extras: {
        judge: "rowan",
        original_verdict_event_id: row.review_verdict_event_id || null,
        downstream_evidence_event_id: null,
        error_kind: "skipped_when_needed",
        todo_event_id: row.id,
        age_ms: age,
      },
    });
    console.log(JSON.stringify({
      status: "phoenix_review_timeout",
      todo_id: row.id,
      age_ms: age,
    }));
    // C3: timeout = no verdict. Fail closed (park for operator) unless opted in.
    handleReviewBypass(row, dedupKey, { id: row.source_event_id || row.id, type: "synthetic-timeout" }, "timeout");
  }
}

function handleReviewCompleted(event) {
  const payload = event.payload || {};
  const todoId = payload.todo_event_id;
  if (!todoId) return;
  // Find the row that was awaiting this review.
  let row = null;
  let dedupKey = null;
  for (const [k, r] of index) {
    if (r.id === todoId && r.action_phase === "awaiting_review") {
      row = r;
      dedupKey = k;
      break;
    }
  }
  if (!row) {
    // No matching pending row — review for an already-resolved or non-flywheel
    // event. Log and skip.
    return;
  }
  const verdict = payload.verdict;
  const ack = payload.ack || {};

  if (verdict === "PASS") {
    row.review_verdict = "PASS";
    row.review_judge = ack.judge || "rowan";
    row.review_top_finding = ack.top_finding || null;
    row.review_completed_at = event.created_at;
    row.review_verdict_event_id = event.id;  // enables judge.error references (task #16b)
    rewriteAllTodos();
    commitAndPushFromWorktree(row, dedupKey, event, row.worktree_path);
  } else if (verdict === "FAIL") {
    row.review_verdict = "FAIL";
    row.review_judge = ack.judge || "rowan";
    row.review_top_finding = ack.top_finding || null;
    row.review_completed_at = event.created_at;
    row.review_verdict_event_id = event.id;  // enables judge.error references
    rewriteAllTodos();
    rejectAttempt(row, dedupKey, event,
      `${ack.judge || "rowan"} review failed: ${ack.top_finding || "no detail provided"}`,
      row.worktree_path);
  } else {
    // Unknown verdict — leave the row in awaiting_review and surface a warning.
    console.error(`[phoenix] unknown verdict "${verdict}" for todo ${todoId}; leaving awaiting_review`);
  }
}

// C3/C4: the review gate must FAIL CLOSED. Reviewer-dispatch failure, review
// timeout, and malformed replies previously all fell back to landing an UNGATED
// commit with no human in the loop. Now they emit a dedicated
// flywheel.review.bypassed event and park the todo in a terminal needs_review
// state requiring operator approval — unless --allow-ungated-fallback is set,
// which restores the degraded land-anyway behavior (still emitting the event
// for audit).
function handleReviewBypass(row, dedupKey, event, subReason) {
  emitFactoryEvent({
    type: "flywheel.review.bypassed",
    behavior: "factory-flywheel",
    reason: `review.${subReason}`,
    message: `review bypassed (${subReason}) for todo ${row.id}; allow_ungated_fallback=${ALLOW_UNGATED_FALLBACK}`,
    extras: {
      todo_event_id: row.id,
      sub_reason: subReason,
      judge: row.review_reviewer_agent_key || "rowan",
      allow_ungated_fallback: ALLOW_UNGATED_FALLBACK,
      worktree_path: row.worktree_path || null,
    },
  });
  if (ALLOW_UNGATED_FALLBACK) {
    // Operator opted into degraded auto-commit.
    if (row.worktree_path) {
      commitAndPushFromWorktree(row, dedupKey, event, row.worktree_path);
    } else {
      releaseActionLock(row.id);
    }
    return;
  }
  // Fail closed: park for operator review. Preserve the worktree (it holds the
  // staged diff for later approval) and release the per-todo lock so an
  // operator-approved retry can proceed.
  row.action_phase = "needs_review";
  row.review_verdict = `BYPASSED_${subReason.toUpperCase()}`;
  row.review_completed_at = new Date().toISOString();
  row.needs_review_reason = subReason;
  rewriteAllTodos();
  releaseActionLock(row.id);
  console.log(JSON.stringify({
    status: "phoenix_review_bypassed_needs_review",
    todo_id: row.id,
    sub_reason: subReason,
    worktree_path: row.worktree_path || null,
  }));
}

function commitAndPushFromWorktree(row, dedupKey, event, worktreePath) {
  // Per-fix-branch lock (Gap F). Serializes `git update-ref` + `git push`
  // on the day's flywheel-fixes branch so two concurrent commit-and-push
  // sequences never race to push and produce intermittent non-fast-forward
  // rejections (or worse, a lost commit if the loser's worktree gets cleaned
  // up before retry).
  const fixBranch = todayBranchName();
  const branchLock = acquireLock(`flywheel-fixbranch-${fixBranch}`, { ttlMs: 5 * 60 * 1000 });
  if (!branchLock) {
    rejectAttempt(row, dedupKey, event,
      `could not acquire fix-branch lock for ${fixBranch}; another commit is in flight`,
      worktreePath);
    return;
  }
  try {
    return commitAndPushFromWorktreeImpl(row, dedupKey, event, worktreePath);
  } finally {
    try { branchLock(); } catch {}
    releaseActionLock(row.id);
  }
}

// Latest Sentinel safety verdict for a todo, read from the event log.
// Returns "blocked" | "allowed" | null (no verdict yet).
function safetyVerdictForTodo(todoId) {
  try {
    const eventsPath = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
    if (!existsSync(eventsPath)) return null;
    let verdict = null;
    for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if ((ev.type === "safety.blocked" || ev.type === "safety.allowed") &&
          ev.payload?.todo_event_id === todoId) {
        verdict = ev.type === "safety.blocked" ? "blocked" : "allowed";
      }
    }
    return verdict;
  } catch { return null; }
}

function commitAndPushFromWorktreeImpl(row, dedupKey, event, worktreePath) {
  // SAFETY GATE (Sentinel harm monitor). Fail closed: NEVER push a diff the
  // Sentinel flagged as harmful (secret, destructive shell, exfiltration, etc.).
  // With --require-safety, also refuse to push without an explicit ALLOW.
  const safety = safetyVerdictForTodo(row.id);
  if (safety === "blocked") {
    rejectAttempt(row, dedupKey, event, "blocked by Sentinel safety monitor: harmful diff", worktreePath);
    return;
  }
  if (REQUIRE_SAFETY && safety !== "allowed") {
    handleReviewBypass(row, dedupKey, event, "safety_unverified");
    return;
  }
  // CRUD-replay-safety (Gap I / Task #28). Capture worktree state hash BEFORE
  // any mutation, then again after, and emit a state-mutation event so the
  // commit can be replayed deterministically from the event log alone.
  let stateBefore = null;
  try { stateBefore = hashGitState(worktreePath); } catch {}
  spawnSync("git", ["add", "-A"], { cwd: worktreePath });
  const commitMsg = `flywheel: ${row.title || "fix " + (row.failure_reason || "")}

Auto-generated commit from the dark factory flywheel.
todo_id: ${row.id}
failure_event: ${row.failure_event_id}
failure_reason: ${row.failure_reason}
recommended_agent: ${row.recommended_agent}
diff source: ${row.source_event_id || event.id}
review: ${row.review_judge || "(not gated)"} ${row.review_verdict || ""} ${row.review_top_finding ? "— " + row.review_top_finding : ""}

Diff was applied to a fresh worktree, tests passed${row.review_verdict === "PASS" ? `, ${row.review_judge || "reviewer"} approved` : ""}.

Co-Authored-By: ${row.recommended_agent} (via flywheel)
`;
  const commit = spawnSync("git", ["commit", "-m", commitMsg], { cwd: worktreePath, encoding: "utf8" });
  if (commit.status !== 0) {
    rejectAttempt(row, dedupKey, event, `commit failed: ${commit.stderr.slice(0, 300)}`, worktreePath);
    return;
  }
  const shaRes = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8" });
  const sha = (shaRes.stdout || "").trim();

  // Merge the commit into the day's fix branch (or create it).
  const branch = todayBranchName();
  // Ensure branch exists in inner repo
  const branchExists = git(["rev-parse", "--verify", branch], { cwd: INNER_REPO }).status === 0;
  if (!branchExists) {
    const createBr = git(["branch", branch, "main"], { cwd: INNER_REPO });
    if (createBr.status !== 0) {
      console.error("[phoenix] create branch failed:", createBr.stderr);
    }
  }
  // Fast-forward fix branch to the new commit if possible; else merge.
  // Easiest: switch fix branch HEAD to the worktree's commit via update-ref
  // (works because fix branch was created off main and worktree was off main).
  const updateRef = git(["update-ref", `refs/heads/${branch}`, sha], { cwd: INNER_REPO });
  if (updateRef.status !== 0) {
    console.error("[phoenix] update-ref failed:", updateRef.stderr);
  }

  // Push the fix branch.
  const push = git(["push", "origin", branch], { cwd: INNER_REPO });
  const pushed = push.status === 0;

  // Open (or update) a PR against main so the flywheel commits actually
  // flow into the trunk instead of accumulating on a feature branch
  // forever. Operator still has final merge authority via the PR's
  // review/merge buttons; the flywheel just makes the changeset visible.
  let prUrl = null;
  let prCreated = false;
  let merged = false; // pt.18 Phase 3: set true when auto-merge is queued/landed
  if (pushed) {
    // Use gh CLI from the inner repo. `gh pr create` returns the PR URL
    // on success; `gh pr view --json url` after if we need to re-derive.
    const REPO_SLUG = "gagan114662/activegraph";
    // Check if a PR for this branch already exists
    const existing = spawnSync("gh", ["pr", "view", branch, "--repo", REPO_SLUG, "--json", "url,number"],
      { cwd: INNER_REPO, encoding: "utf8" });
    if (existing.status === 0) {
      try {
        const data = JSON.parse(existing.stdout);
        prUrl = data.url;
      } catch {}
    } else {
      const prTitle = `flywheel: ${row.title || "fix " + (row.failure_reason || "")}`.slice(0, 200);
      const prBody = [
        "Auto-opened by the dark factory flywheel.",
        "",
        `**Todo id:** ${row.id}`,
        `**Failure event:** ${row.failure_event_id}`,
        `**Failure reason:** ${row.failure_reason}`,
        `**Recommended agent:** ${row.recommended_agent}`,
        `**Commit:** ${sha}`,
        `**Review:** ${row.review_judge || "(not gated)"} ${row.review_verdict || ""} ${row.review_top_finding ? "— " + row.review_top_finding : ""}`,
        `**Tests:** ${row.test_summary || "(pass)"}`,
        "",
        "Operator: review the diff, then merge (or close if the flywheel was wrong).",
        "If wrong, please add a comment so judge-error-detector can grade Rowan's verdict downstream.",
      ].join("\n");
      const create = spawnSync(
        "gh",
        ["pr", "create", "--base", "main", "--head", branch, "--title", prTitle, "--body", prBody, "--repo", REPO_SLUG],
        { cwd: INNER_REPO, encoding: "utf8" }
      );
      if (create.status === 0) {
        prUrl = (create.stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("https://"))?.trim() || null;
        prCreated = true;
      } else {
        console.error("[phoenix] gh pr create failed:", create.stderr?.slice(0, 300));
        // H14: surface PR-creation failure as an event (was previously only a
        // console line). The commit pushed but no PR exists for the operator.
        emitFactoryEvent({
          type: "flywheel.pr.create_failed",
          behavior: "factory-flywheel",
          reason: "flywheel.pr_create_failed",
          message: String(create.stderr || "gh pr create failed").slice(0, 300),
          extras: { todo_event_id: row.id, branch, sha },
        });
      }
    }

    // pt.18 Phase 3: AUTONOMOUS MERGE (flag-gated, default OFF). Four-gate chain —
    // AUTO_MERGE on, a real PR exists, Rowan PASS (never a bypass), a FRESH Sentinel
    // safety.allowed (re-read here to close the merge-races-safety window), and
    // REQUIRE_SAFETY in force. `gh pr merge --auto` then lets GitHub merge ONLY after
    // the required CI check (deploy-verification) passes. Every decision is an event.
    if (AUTO_MERGE && prUrl) {
      const freshSafety = safetyVerdictForTodo(row.id);
      const gates = {
        review_pass: row.review_verdict === "PASS",
        safety_allowed: freshSafety === "allowed",
        require_safety: REQUIRE_SAFETY,
      };
      const failedGates = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
      if (failedGates.length === 0) {
        const m = spawnSync("gh", ["pr", "merge", branch, "--repo", REPO_SLUG, "--auto", "--squash", "--delete-branch"],
          { cwd: INNER_REPO, encoding: "utf8" });
        if (m.status === 0) {
          merged = true; // --auto: queued; GitHub completes the merge after required CI passes
          emitFactoryEvent({
            type: "flywheel.pr.merged", behavior: "factory-flywheel",
            extras: { todo_event_id: row.id, branch, sha, pr_url: prUrl,
              merge_method: "squash-auto", safety: freshSafety, review_verdict: row.review_verdict },
          });
        } else {
          emitFactoryEvent({
            type: "flywheel.merge.failed", behavior: "factory-flywheel", reason: "flywheel.merge_failed",
            message: String(m.stderr || "gh pr merge failed").slice(0, 300),
            extras: { todo_event_id: row.id, branch, sha, pr_url: prUrl },
          });
        }
      } else {
        emitFactoryEvent({
          type: "flywheel.merge.skipped", behavior: "factory-flywheel", reason: "flywheel.merge_skipped",
          message: `auto-merge skipped; gates not met: ${failedGates.join(",")}`,
          extras: { todo_event_id: row.id, branch, sha, pr_url: prUrl,
            failed_gates: failedGates, fresh_safety: freshSafety, review_verdict: row.review_verdict || null },
        });
      }
    }
  }

  // Capture state-after for the CRUD-replay-safety record.
  let stateAfter = null;
  try { stateAfter = hashGitState(worktreePath); } catch {}
  emitStateMutation({
    type: "state.git_commit",
    behavior: "factory-flywheel",
    mutation_kind: "git_commit",
    state_before_hash: stateBefore,
    state_after_hash: stateAfter,
    target: `${INNER_REPO}#${sha}`,
    extras: {
      todo_event_id: row.id,
      sha,
      worktree_path: worktreePath,
      branch,
      pushed,
    },
  });

  // H14: only COMPLETE the todo when the commit actually reached the remote.
  // A push failure leaves the commit local-only — the work is NOT done, so
  // marking it completed would orphan the commit and stop any retry. Park it in
  // a needs_push state instead so the operator (or a future retry) can finish.
  if (!pushed) {
    row.action_phase = "needs_push";
    row.completion_evidence = `flywheel commit ${sha.slice(0, 12)} on ${branch} — PUSH FAILED, NOT completed (local only)`;
  } else if (AUTO_MERGE && !merged) {
    // pt.18 Phase 3: auto-merge was expected but the gates/merge didn't go through.
    // The PR is open; do NOT mark done — park needs_merge so it's visibly unfinished.
    row.action_phase = "needs_merge";
    row.completion_evidence = `flywheel commit ${sha.slice(0, 12)} on ${branch} pushed${prUrl ? " PR: " + prUrl : ""} — AUTO-MERGE NOT completed (gates unmet or merge failed)`;
  } else {
    row.completed_at = new Date().toISOString();
    row.completion_evidence = `flywheel commit ${sha.slice(0, 12)} on ${branch} (pushed)${prUrl ? " PR: " + prUrl : ""}${merged ? " [auto-merge queued]" : ""}`;
    counts.todos_completed++;
  }
  row.flywheel_commit_sha = sha;
  row.flywheel_branch = branch;
  row.flywheel_push_succeeded = pushed;
  row.flywheel_merge_queued = merged;
  row.flywheel_pr_url = prUrl;
  row.flywheel_pr_created_at = prCreated ? new Date().toISOString() : null;
  row.state_before_hash = stateBefore;
  row.state_after_hash = stateAfter;
  rewriteAllTodos();

  emitFactoryEvent({
    type: pushed ? "flywheel.commit.landed" : "flywheel.commit.local_only",
    behavior: "factory-flywheel",
    extras: {
      todo_event_id: row.id,
      sha,
      branch,
      pushed,
      worktree_path: worktreePath,
      review_judge: row.review_judge || null,
      review_verdict: row.review_verdict || null,
      rationale: row.diff_rationale || null,
      // C6: carry the same CRUD-replay state hashes the state.git_commit event
      // has, so crud-replay-verifier can't be fooled into trusting a hashless
      // mutation record (the two events now agree).
      mutation_kind: "git_commit",
      state_before_hash: stateBefore,
      state_after_hash: stateAfter,
      crud_replay_safe: Boolean(stateBefore && stateAfter),
    },
  });

  console.log(JSON.stringify({
    status: "phoenix_flywheel_commit",
    todo_id: row.id,
    sha,
    branch,
    pushed,
  }));

  // Worktree cleanup (Gap H). Always remove the worktree after successful
  // commit + push so /tmp doesn't fill up over time. Forensics for failed
  // attempts handled in rejectAttempt (kept until next reload cycle).
  try {
    rmSync(worktreePath, { recursive: true, force: true });
    git(["worktree", "prune"], { cwd: INNER_REPO });
  } catch (e) {
    console.error("[phoenix] worktree cleanup failed:", e.message);
  }
}

// Map a free-text rejection reason to a stable category code so analysis
// doesn't need substring parsing of payload.message (P1d). Order matters —
// check the most specific phrases first.
function categorizeRejection(reason) {
  const r = String(reason || "").toLowerCase();
  if (r.includes("empty diff")) return "empty_diff";
  if (r.includes("apply") || r.includes("patch does not apply") || r.includes("corrupt patch") || r.includes("no valid patch")) return "apply_failed";
  if (r.includes("test") || r.includes("pytest")) return "tests_failed";
  if (r.includes("commit")) return "commit_failed";
  if (r.includes("worktree")) return "worktree_failed";
  if (r.includes("lock")) return "lock_contention";
  return "other";
}

function rejectAttempt(row, dedupKey, sourceEvent, reason, worktreePath = null) {
  // Release the per-todo action lock so this slot is reusable. The lock
  // exists only while the action is in flight; rejection terminates the
  // action.
  if (row?.id) releaseActionLock(row.id);
  const category = categorizeRejection(reason);
  // P1d: synthetic test fixtures pollute the throughput signal. Tag them so
  // analysis can exclude them (derive from the source event or the row).
  const isSynthetic = Boolean(sourceEvent?.payload?.synthetic || row?.synthetic || row?.source_event_type === "synthetic-timeout");
  row.completed_at = new Date().toISOString();
  row.completion_evidence = `attempt_rejected: ${reason}`;
  row.flywheel_rejection_reason = reason;
  row.flywheel_rejection_category = category;
  counts.todos_completed++;
  rewriteAllTodos();
  emitFactoryEvent({
    type: "flywheel.attempt.rejected",
    behavior: "factory-flywheel",
    // P1d: the real cause now lives in reason (was the constant
    // "flywheel.attempt_rejected", forcing substring parsing of message).
    reason: `flywheel.${category}`,
    message: reason.slice(0, 280),
    extras: {
      todo_event_id: row.id,
      dedup_key: row.dedup_key,
      source_event_id: sourceEvent.id,
      worktree_path: worktreePath,
      rejection_category: category,
      synthetic: isSynthetic,
    },
  });
  console.log(JSON.stringify({
    status: "phoenix_flywheel_rejected",
    todo_id: row.id,
    reason: reason.slice(0, 200),
  }));
  if (worktreePath) {
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch {}
    try { git(["worktree", "prune"], { cwd: INNER_REPO }); } catch {}
  }
}

// --- Bootstrap ---

ensureTodosFile();
loadExistingTodos();

console.log(
  JSON.stringify({
    status: "phoenix_started",
    todos_path: TODOS_PATH,
    dry_run: DRY_RUN,
    mode: LEGACY_POLL ? "legacy-file-poll" : "honker-subscribe",
    age_to_p1_hours: AGE_TO_P1_HOURS,
    autodispatch: AUTODISPATCH,
    dispatch_rate_limit: AUTODISPATCH
      ? `${DISPATCH_MAX_PER_WINDOW}/${DISPATCH_WINDOW_MS}ms`
      : "off",
    dispatch_circuit_threshold: AUTODISPATCH ? DISPATCH_CIRCUIT_THRESHOLD : "off",
  })
);

let honkerSub = null;
if (!LEGACY_POLL) {
  honkerSub = subscribeToFactoryEvents(
    (event) => processEvent(event),
    {
      onWarning: (msg) => console.error("[phoenix:honker-subscribe]", msg),
    }
  );
} else {
  // Minimal file-poll fallback. Not realtime; primarily for dev environments
  // where the honker substrate is unavailable.
  const EVENTS_PATH = resolve(
    process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
  );
  let lastSize = existsSync(EVENTS_PATH) ? statSync(EVENTS_PATH).size : 0;
  const interval = setInterval(() => {
    if (!existsSync(EVENTS_PATH)) return;
    const size = statSync(EVENTS_PATH).size;
    if (size <= lastSize) return;
    const buf = readFileSync(EVENTS_PATH, "utf8").slice(lastSize);
    lastSize = size;
    for (const line of buf.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { processEvent(JSON.parse(line)); } catch { counts.malformed_events++; }
    }
  }, 1000);
  process.on("SIGTERM", () => clearInterval(interval));
}

// Scan for stuck awaiting_review todos every 60s (Gap B from the audit).
const stuckScanInterval = setInterval(scanStuckReviews, 60_000);

// Panic kill switch (Gap L). If ~/.factory/PANIC exists, all factory daemons
// exit immediately. factory-activate.sh removes the file at startup.
const PANIC_PATH = `${process.env.HOME}/.factory/PANIC`;
const panicWatchInterval = setInterval(() => {
  if (existsSync(PANIC_PATH)) {
    console.error("[phoenix] PANIC file detected — exiting immediately");
    process.exit(2);
  }
}, 5000);

function shutdown(signal) {
  console.log(JSON.stringify({ status: "phoenix_shutting_down", signal, counts }));
  if (honkerSub) honkerSub.close();
  clearInterval(stuckScanInterval);
  clearInterval(panicWatchInterval);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
