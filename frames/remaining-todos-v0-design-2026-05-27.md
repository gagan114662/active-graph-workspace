# Remaining backlog v0 design docs — 2026-05-27 wrap

Five items deemed "too large to ship tonight" but with enough scope
clarity to write concrete starting points. Each section is a self-
contained spec the next session can execute against.

## Task #27 — ClaudeCodeCliProvider v2: MCP/tool wiring

**Goal:** Support `tools=[...]` in `ClaudeCodeCliProvider.complete()` so
activegraph `@llm_behavior` definitions with custom `@tool` functions
can run on the operator's Claude Code subscription.

**v1 (shipped today):** raises `NotImplementedError` if `tools` arg is
non-empty.

**v2 approach (recommended — inline stdio MCP server):**

1. Add a new module `activegraph/llm/_mcp_tool_server.py` that:
   - Accepts a list of `Tool` definitions at construction time.
   - Implements the MCP stdio JSON-RPC protocol on stdin/stdout
     (`initialize`, `tools/list`, `tools/call`, `shutdown`).
   - Calls the corresponding Python `Tool.function` when claude invokes
     a tool via `tools/call`, returns the result.
2. Provider spawns this MCP server as a subprocess BEFORE the claude
   subprocess, passes `--mcp-config '{"mcpServers":{"activegraph":{"command":"python","args":["-m","activegraph.llm._mcp_tool_server","--tools",...]}}}` to claude.
3. Parse `tool_use` blocks out of claude's stream-json `assistant`
   messages. Return them as `LLMResponse.tool_calls`.
4. Runtime's existing tool-use loop calls the tool, builds `role="tool"`
   echo message, re-calls `complete()`.

**Estimated effort:** half day for end-to-end + tests. Pre-requisite for
task #28.

**Alternative (v2b — long-lived shared MCP server):** Start one MCP
server at provider construction time, reuse across `complete()` calls.
More state to manage but faster per-call.

---

## Task #28 — Bridge uses ClaudeCodeCliProvider

**Goal:** The Node.js bridge's `runClaude()` becomes a thin wrapper around
activegraph's `Runtime.run_goal()` + `ClaudeCodeCliProvider.complete()`.
Bridge dispatches become first-class activegraph events instead of
JSONL-format file events.

**Blocker:** This requires #27 (tool support) because the bridge passes
Pentagon MCP server config to claude — the v1 provider supports MCP via
its `mcp_config` constructor arg but doesn't support per-`complete()`-call
tools. With #27, the bridge can construct a provider once at startup
with the Pentagon MCP server, and call `complete()` per trigger.

**v0 design — Node wraps Python via subprocess:**

The bridge is Node.js; activegraph is Python. Two integration shapes:

A. **Node spawns Python per trigger** (simplest):
   - Bridge writes the trigger content + agent identity to a tempfile.
   - Spawns `python -m activegraph.dark_factory.bridge_dispatch <tempfile>`.
   - Python loads `ClaudeCodeCliProvider` + `Runtime`, runs the goal,
     persists events to factory-events.jsonl via `factory_events.py`.
   - Python exits; Node reads its stdout JSON result.

B. **Node + Python long-lived IPC** (faster):
   - Python "dispatch server" running as a sibling daemon.
   - Bridge talks to it over a Unix socket per trigger.
   - Survives across triggers; lower per-trigger overhead.

A is simpler and fits today's bridge architecture (already spawns claude
subprocess per trigger). Recommended for v1.

**Estimated effort:** 1 day (~half for #27 + half for #28's Python
shim + Node wiring).

---

## Task #20 — Pullfrog-style GitHub bot with Claude Code subscription

**Goal:** Replicate Pullfrog (open-source AI GitHub bot) but with auth
flowing through the operator's Claude Code MAX subscription instead of
an Anthropic API key. The cleanest path uses a **self-hosted GitHub
Actions runner** on the operator's Mac, which inherits local `claude`
CLI keychain auth.

**v0 setup:**

1. **Create a self-hosted runner** on the Mac:
   - GitHub repo Settings → Actions → Runners → New self-hosted runner.
   - Follow GitHub's instructions to download + register. Runs as a
     user-level launchd service.
2. **Write a workflow** `.github/workflows/pullfrog.yml` in
   gagan114662/activegraph that:
   - Listens for `issue_comment` events containing `@pullfrog`.
   - Runs on the self-hosted runner.
   - Invokes `claude -p --output-format=stream-json ...` with the
     comment as input + appropriate context (PR diff, issue body).
   - Posts the response back as a comment via `gh pr comment` or `gh issue comment`.
3. **The webhook handler** (just a GitHub Actions job that triggers on
   `issue_comment.created`) reads the comment, decides whether to act,
   spawns claude.

**Estimated effort:** 1-2 days. The self-hosted runner setup is the
biggest single step; the rest is straightforward shell + claude CLI.

**Risks:**
- Runner availability depends on the Mac being awake + connected.
- Claude Code session limits apply (same as today's bridge — can hit 429s).
- Operator should add Blake budget gating BEFORE turning this on or it
  burns subscription quota on every random `@pullfrog` mention.

---

## Task #29 — Per-agent Puter computers

**Goal:** Self-host Puter (github.com/heyputer/puter) and give each
Pentagon agent its own sandbox computer. Sandbox isolation between
agents; reproducible per-agent filesystem snapshots; auditable Puter
sessions.

**v0 setup:**

1. **Install + run Puter locally** on the Mac per their docs:
   - `git clone https://github.com/heyputer/puter`
   - `cd puter && npm install && npm start`
   - Open `http://puter.localhost:4100`.
2. **Provision 20 Puter users** — one per active_graph agent (Maya,
   Quinn, ..., Theo). Each gets its own home directory.
3. **Update the bridge's `runClaude()`** to pass the agent's Puter
   user's home directory as CWD instead of the global WORKSPACE.
4. **Optionally** route claude's filesystem tool calls through Puter's
   filesystem API so every file operation lands in Puter's audit log.

**Estimated effort:** 1 day for steps 1-3; another half day for full
audit integration.

**Open questions:**
- Per the Puter README we read, sandbox isolation isn't explicitly
  documented. May need to confirm experimentally that one Puter user's
  process can't read another's filesystem.
- Multi-process per agent (Maya runs pytest + ruff + git in one
  trigger) needs to all happen within the same Puter session for the
  audit trail to be coherent.

---

## Task #30 — Honker as activegraph's realtime substrate

**Goal:** Replace activegraph's SQLite event store with a Honker-backed
SQLite that exposes Postgres-style NOTIFY/LISTEN semantics. Sasha and
other watchers stop polling JSONL; they LISTEN on the SQLite file
directly.

**Install path:**

Honker is Rust-only with no npm/pip package available as of
2026-05-27. Build from source via `cargo install --git
https://github.com/russellromney/honker honker-cli` (or the appropriate
crate name). Output is a SQLite loadable extension (`honker.dylib`).

**v0 integration:**

1. **Wrap activegraph's SQLite persistence** to load the Honker
   extension at connection time:
   ```python
   conn.enable_load_extension(True)
   conn.load_extension("/path/to/honker.dylib")
   ```
2. **Migrate factory-events.jsonl → SQLite** with a Honker-aware
   schema. Single-table append-only.
3. **Update Sasha + Blake** to use Honker's LISTEN instead of file
   polling. Replaces `setInterval(pollNewEvents, 1000)` with
   `honker.listen('factory_events', callback)`.
4. **Bridge writes** call Honker's `notify()` after each
   `appendFileSync(factory-events.jsonl)` (or replace JSONL write with
   SQLite insert + notify).

**Wins:**
- 1ms event-detection latency vs. 1000ms polling.
- Zero file-poll overhead for Sasha/Blake/F1.
- Transactional consistency: emit + state-update in one SQLite write.
- Solves the original orphan-trigger problem at the substrate level.

**Estimated effort:** half day for cargo install + extension load
plumbing; full day for full Sasha/Blake/F1 migration to LISTEN.

---

## Suggested order for the next session

1. **#27 then #28** (1-1.5 days) — the unification capstone. After
   this, all activegraph behaviors AND bridge dispatches use ONE
   provider AND emit ONE format of events. Pre-requisite for several
   downstream items (Pullfrog cleanup, Honker migration).
2. **#30 Honker** (half day) — substrate upgrade. Makes everything
   else faster.
3. **#20 Pullfrog** (1-2 days) — public-facing payoff. After #27+#28,
   the same provider that drives Pentagon agents can drive PR review.
4. **#29 Puter** (1-2 days) — security/audit win. Lower priority
   until there's a reason to scale agents 24/7 (i.e. positive
   per-token-arbitrage).

Total: ~5-7 dedicated engineering days to close everything.
