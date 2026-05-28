# Backlog: RESOLVER.md context-routing framework (Garry Tan / gbrain)

**Added:** 2026-05-28 (operator request — "add this to the to-do").

## The idea
A **resolver** is a context-engineering pattern: instead of dumping every rule and file instruction
into the agent's active context (which pollutes the window — exactly what our ~1200-line monolithic
`CLAUDE.md` does today), a `RESOLVER.md` acts as a **dynamic routing table** that loads only the
context relevant to the current action.

Four mechanics (from Garry Tan's gbrain + "thin harness, fat skills"):
1. **Hierarchical decision tree** — root file with conditional syntax: "if modifying file path X →
   load context doc Y." E.g. *if an agent edits a prompt/rubric config → auto-load the eval suite*
   (so the agent gets the exact knowledge without a human linking it).
2. **MECE directory structure** — every file/rule/component has exactly ONE primary home. Overlaps
   are handled by typed backlinks/cross-references, never duplication.
3. **`inbox/` disambiguation** — context that doesn't cleanly fit the tree routes to an explicit
   `inbox/`; a signal that the schema needs to evolve.
4. **Constrain the latent space** — a deterministic resolver map stops the LLM from burning tokens
   guessing/hallucinating the codebase structure.

Refs: `github.com/garrytan/gbrain/blob/master/docs/GBRAIN_RECOMMENDED_SCHEMA.md`,
`yage.ai/share/thin-harness-fat-skills-en-20260414.html`, x.com/garrytan/status/2046981289031667961.

## Why it fits THIS project (strong)
- **`CLAUDE.md` is the anti-pattern this fixes.** It's ~1200 lines loaded into every session — the
  "dump everything" approach. A resolver would route: "editing the verifier → load verifier-hardening
  history + gaming-holes; editing a rubric → load the judge eval suite + ground truth; editing the
  bridge → load the dispatch/cascade notes" — instead of all of it, always.
- **We already built a primitive resolver this session:** `pentagon-trigger-bridge.mjs::researchPacketFor`
  (3a) loads recent commits + similar failures + the relevant doc section for the *target symbol*.
  That's a per-dispatch resolver. RESOLVER.md generalizes it to a project-wide, action-conditioned map.
- **MECE + inbox** map onto `agent-os/` (contracts/skills/rubrics/judges) and `frames/` (specs/
  proofs/goals) — which already have implicit homes; a RESOLVER.md would make the routing explicit
  and machine-followable.

## Scoped first build
1. `RESOLVER.md` at repo root — a decision-tree table: `when editing <glob> → load <doc(s)>`.
   Seed rules: verifier / routing-config / rubrics / bridge / phoenix / activegraph package / frames.
2. Split the monolithic `CLAUDE.md` into MECE topic docs under `agent-os/context/` (dispatch,
   verifier, flywheel, cohort, defects, activity-log) — `CLAUDE.md` becomes a thin index that points
   at the resolver. Keep the activity log as its own doc.
3. `inbox/` dir for context that doesn't fit yet.
4. Wire the resolver into the agent prompt path: extend `researchPacketFor` (and Phoenix's dispatch)
   to consult RESOLVER.md — given the target file/symbol, load the routed docs instead of (or before)
   crawling. This makes the resolver *operational*, not just documentation.
5. (Optional) a tiny `scripts/resolve-context.mjs <path>` that returns the doc set a resolver maps a
   path to — testable + reusable by every dispatch.

## Sequencing
Lower urgency than the live A+ work, but high-leverage for token efficiency + agent reliability
(pairs directly with the research-packet 6× lever). Natural follow-on after the dataset-growth +
Grace-rubric work, or whenever CLAUDE.md's size next causes friction.
