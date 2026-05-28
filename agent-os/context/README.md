# agent-os/context/ — MECE topic docs (P21, gbrain schema adoption)

The anti-pattern this fixes: dumping all ~1500 lines of `CLAUDE.md` into context on
every task (discipline rule 9). `RESOLVER.md` routes "editing file X → load docs Y",
and these are the focused, **single-source** docs it routes to. Each doc owns ONE
topic; `CLAUDE.md` keeps a one-line pointer where the section used to be.

## Migrated (single source lives here, CLAUDE.md points to it)
- [discipline.md](discipline.md) — the discipline rules that never bend
- [repo-layout.md](repo-layout.md) — outer/inner nested-repo layout + `-C activegraph` rule

## Staged migration (still inline in CLAUDE.md; move next, single-source, fixing drift)
- cohort.md — active cohort (NOTE drift: CLAUDE.md still says opus-4.7; live cohort is
  **opus-4.8-claude-code-2026-05-28** per `agent-os/agent-cohort.json`, the real canonical source)
- tier-ladder.md — the T6–T17 ladder + honest sample sizes
- critical-files.md — the verifier/runner/bridge/spec file map
- gaming-holes.md — known verifier gaming holes (T11 backlog)
- defects.md — known factory defects table
- The Activity Log + Open Backlog stay in CLAUDE.md (append-only narrative / working list — low routing value).

Rule: when you move a section here, DELETE it from CLAUDE.md and leave a pointer — never
duplicate (two copies drift, which is the exact failure this dir prevents).
