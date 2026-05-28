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
import { emitFactoryEvent } from "./factory-events.mjs";
import { dispatchTodo } from "./pentagon-rest.mjs";

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
    // Action layer (task #15): an agent proposed a unified diff. Apply
    // it to a worktree, run tests, commit on pass or discard on fail.
    handleDiffProposed(event);
  }
  // Also consider any behavior.completed with extras.todo_id as an implicit
  // todo completion (lets agents close their assigned todos by emitting the
  // standard completion event with a todo_id tag).
  if (event.type === "behavior.completed" && event.payload?.todo_id) {
    handleTodoCompletion(event);
  }
}

// --- Action layer (task #15) ---

const INNER_REPO = "/Users/gaganarora/Desktop/my projects/active_graph/activegraph";
const FLYWHEEL_FIX_BRANCH_PREFIX = "flywheel-fixes-";

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
  // Find the matching todo row (must exist + still be open).
  let row = null;
  let dedupKey = null;
  for (const [k, r] of index) {
    if (r.id === todoId) { row = r; dedupKey = k; break; }
  }
  if (!row) {
    console.error(`[phoenix] flywheel.diff.proposed for unknown todo ${todoId}; skipping`);
    return;
  }
  if (row.completed_at) {
    console.error(`[phoenix] todo ${todoId} already completed; skipping diff application`);
    return;
  }
  if (row.diff_attempted_at) {
    console.error(`[phoenix] todo ${todoId} already had a diff attempt; skipping duplicate`);
    return;
  }
  row.diff_attempted_at = new Date().toISOString();
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

  // Create a fresh worktree off main HEAD.
  const wt = git(["worktree", "add", "-B", `flywheel-attempt-${todoId.slice(0, 24)}`, worktreePath, "main"], { cwd: INNER_REPO });
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
    try { spawnSync("ln", ["-s", innerVenv, worktreeVenv], { encoding: "utf8" }); } catch {}
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

  // Tests pass: stage + commit in the worktree.
  spawnSync("git", ["add", "-A"], { cwd: worktreePath });
  const commitMsg = `flywheel: ${row.title || "fix " + (row.failure_reason || "")}

Auto-generated commit from the dark factory flywheel.
todo_id: ${row.id}
failure_event: ${row.failure_event_id}
failure_reason: ${row.failure_reason}
recommended_agent: ${row.recommended_agent}
diff source: ${event.id}

Diff was applied to a fresh worktree, tests passed.

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

  row.completed_at = new Date().toISOString();
  row.completion_evidence = `flywheel commit ${sha.slice(0, 12)} on ${branch}${pushed ? " (pushed)" : " (push failed)"}`;
  row.flywheel_commit_sha = sha;
  row.flywheel_branch = branch;
  row.flywheel_push_succeeded = pushed;
  counts.todos_completed++;
  rewriteAllTodos();

  emitFactoryEvent({
    type: pushed ? "flywheel.commit.landed" : "flywheel.commit.local_only",
    behavior: "factory-flywheel",
    extras: {
      todo_event_id: todoId,
      sha,
      branch,
      pushed,
      diff_chars: diff.length,
      worktree_path: worktreePath,
      rationale: payload.rationale || null,
    },
  });

  console.log(JSON.stringify({
    status: "phoenix_flywheel_commit",
    todo_id: todoId,
    sha,
    branch,
    pushed,
  }));

  // Clean up worktree (optional — keeping for forensics; can rmSync if disk pressure).
  // try { rmSync(worktreePath, { recursive: true, force: true }); git(["worktree", "prune"]); } catch {}
}

function rejectAttempt(row, dedupKey, sourceEvent, reason, worktreePath = null) {
  row.completed_at = new Date().toISOString();
  row.completion_evidence = `attempt_rejected: ${reason}`;
  row.flywheel_rejection_reason = reason;
  counts.todos_completed++;
  rewriteAllTodos();
  emitFactoryEvent({
    type: "flywheel.attempt.rejected",
    behavior: "factory-flywheel",
    reason: "flywheel.attempt_rejected",
    message: reason.slice(0, 280),
    extras: {
      todo_event_id: row.id,
      dedup_key: row.dedup_key,
      source_event_id: sourceEvent.id,
      worktree_path: worktreePath,
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

function shutdown(signal) {
  console.log(JSON.stringify({ status: "phoenix_shutting_down", signal, counts }));
  if (honkerSub) honkerSub.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
