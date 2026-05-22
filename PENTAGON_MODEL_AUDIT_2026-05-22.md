# Pentagon Model Audit — 2026-05-22

## Verdict

Current active_graph model policy is: **all Pentagon agents must use `gpt-5.5`**.

This audit supersedes the earlier gauntlet split-model policy that assigned
reviewers to GPT-5 and producers to Opus. Historical judge logs remain
historical evidence and are not rewritten.

## Local App Preference

- Bundle id: `run.pentagon.app`
- Preference checked: `pentagon.defaultModel`
- Observed value after update: `gpt-5.5`
- CLI paths preserved:
  - Codex: `/opt/homebrew/bin/codex`
  - Claude: `/Users/gaganarora/.local/bin/claude`

## Required Per-Agent Policy

The following Dark Factory roles must be configured to `gpt-5.5` in Pentagon:

- Frame Architect
- Goal Reaper
- Budget Marshal
- Spec Owner
- Code Owner
- Test Owner
- CONTRACT Owner
- Docs Owner
- Spec Skeptic
- Test Adversary
- Code Reviewer
- Replay Validator
- Gate Sentinel
- Fork Debugger
- Trace Archivist
- Compatibility Auditor
- Performance Sentinel
- Security Auditor

Renamed or active canvas agents must also resolve to `gpt-5.5`:

- Atlas
- Verdict
- Hawk
- Forge
- Nova

## Verification Status

- Repo policy updated in `GAUNTLET.md`, `activegraph/GAUNTLET.md`, and
  `collaboration-topology.md`.
- Pentagon workspace default updated locally with:
  `defaults write run.pentagon.app pentagon.defaultModel -string "gpt-5.5"`
- Pentagon UI verification:
  - `Spec Owner` settings panel was opened in `/Applications/Pentagon.app`.
  - Observed old value: `Claude Opus 4.7`.
  - Changed value: `GPT-5.5`.
  - Saved successfully.
- Pentagon live agent metadata verification:
  - Map id: `c57026b2-4fe0-46f1-85b4-77bb48d6af94`
  - Rows before live patch: 19 agents, 17 not using `gpt-5.5`.
  - Rows after live patch: 19 agents, 0 not using `gpt-5.5`.
- Local app storage also exposes historical token calibration entries for
  `claude-opus-4-7[1m]`. Those calibration keys are not authoritative model
  assignments and are superseded by the live per-agent `model` values below.
- Live smoke status: direct live metadata readback passed. No separate task
  message was sent because the authoritative model field was verified for every
  active agent after the update.

## Observed Live Agent Models

The active_graph Pentagon map returned these live per-agent model values after
the update:

| Agent | Observed model |
| --- | --- |
| Atlas | `gpt-5.5` |
| Code Reviewer | `gpt-5.5` |
| Compatibility Auditor | `gpt-5.5` |
| CONTRACT Owner | `gpt-5.5` |
| Forge | `gpt-5.5` |
| Fork Debugger | `gpt-5.5` |
| Gate Sentinel | `gpt-5.5` |
| Hawk | `gpt-5.5` |
| Nova | `gpt-5.5` |
| Performance Sentinel | `gpt-5.5` |
| Replay Validator | `gpt-5.5` |
| Research Analyst | `gpt-5.5` |
| Security Auditor | `gpt-5.5` |
| Spec Owner | `gpt-5.5` |
| Spec Skeptic | `gpt-5.5` |
| Test Adversary | `gpt-5.5` |
| Test Owner | `gpt-5.5` |
| Trace Archivist | `gpt-5.5` |
| Verdict | `gpt-5.5` |
